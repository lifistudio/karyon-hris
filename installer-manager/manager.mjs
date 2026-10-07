import { readFile, writeFile, rename, mkdir, mkdtemp, rm, stat, chown, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const imagePattern=/^[a-zA-Z0-9][a-zA-Z0-9./:_@-]{0,254}$/;
export function validServer(value) {
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=="/"||!(url.protocol==="https:"||(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname))))throw new Error("INVALID_LICENSE_SERVER");
  return url.origin;
}
export function replaceImage(env,image) {
  if(!imagePattern.test(image))throw new Error("INVALID_IMAGE");
  if(!/^HRIS_IMAGE=.+$/m.test(env))throw new Error("INSTALLATION_NOT_FOUND");
  return env.replace(/^HRIS_IMAGE=.*$/m,`HRIS_IMAGE=${image}`);
}
/** Repository part of an image reference (`ghcr.io/lifistudio/hris:1.2.0` → `ghcr.io/lifistudio/hris`). */
export function repositoryOf(image){
  const at=image.indexOf("@");const base=at>=0?image.slice(0,at):image;
  const slash=base.lastIndexOf("/"),colon=base.lastIndexOf(":");
  return colon>slash?base.slice(0,colon):base;
}
/** An update may only move to another tag of the official image or of the image already installed. */
export function allowedUpdate(target,current,official){
  if(!imagePattern.test(target)||!/:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(target)||target.includes("@"))return false;
  const repo=repositoryOf(target);
  return repo===official||(!!current&&!current.startsWith("sha256:")&&repo===repositoryOf(current));
}
const BUSY=["validating","downloading","restarting","checking","rolling_back","backing_up"];
export class UpgradeManager {
  constructor({directory="/installation",data="/data",licenseServer,siteOrigin,project,run,runToFile,official="ghcr.io/lifistudio/hris",keepBackups=5,fetcher=fetch,health,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
    this.runToFile=runToFile;this.official=official;this.keepBackups=keepBackups;
    this.directory=directory;this.data=data;this.server=validServer(licenseServer);this.origin=new URL(siteOrigin).origin;
    if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project))throw new Error("INVALID_PROJECT");
    this.project=project;this.run=run;this.fetcher=fetcher;this.health=health;this.delay=delay;this.state={stage:"idle"};this.running=false;
  }
  async save(state){
    const next={...state,updatedAt:new Date().toISOString()};
    await mkdir(this.data,{recursive:true,mode:0o700});
    // Keep the last complete checkpoint if the process stops during a write.
    const file=join(this.data,"status.json"),pending=join(this.data,"status.json.tmp");
    await writeFile(pending,JSON.stringify(next),{mode:0o600});
    await rename(pending,file);
    this.state=next;
  }
  async initialize(){
    try{this.state=JSON.parse(await readFile(join(this.data,"status.json"),"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}
    if(BUSY.includes(this.state.stage)){
      // A process crash during a switch must restore the previous image before accepting another job.
      if(this.state.previousImage&&["restarting","checking","rolling_back"].includes(this.state.stage)){
        try{await this.setImage(this.state.previousImage);await this.startApp();await this.waitHealthy();await this.save({stage:"failed",code:"INTERRUPTED_ROLLED_BACK"});}
        catch{await this.save({stage:"failed",code:"ROLLBACK_FAILED"});}
      }else await this.save({stage:"failed",code:"INTERRUPTED"});
    }
  }
  async setImage(image){
    const file=join(this.directory,".env"),env=await readFile(file,"utf8"),owner=await stat(file);
    await writeFile(`${file}.upgrade.tmp`,replaceImage(env,image),{mode:0o600});
    if(process.platform!=="win32")await chown(`${file}.upgrade.tmp`,owner.uid,owner.gid);
    await rename(`${file}.upgrade.tmp`,file);
  }
  async composeArgs(){
    const args=["compose","--project-name",this.project,"--project-directory",this.directory,"--env-file",join(this.directory,".env"),"-f",join(this.directory,"compose.image.yml"),"-f",join(this.directory,"compose.manager.yml")];
    const env=await readFile(join(this.directory,".env"),"utf8");
    const files=/^COMPOSE_FILE=(.*)$/m.exec(env)?.[1]||"";
    if(files.includes("compose.external.yml"))args.push("-f",join(this.directory,"compose.external.yml"));
    if(files.includes("compose.lifecycle.yml"))throw new Error("LEGACY_LIFECYCLE_LAYOUT");
    return args;
  }
  async startApp(){await this.run([...(await this.composeArgs()),"up","-d","--no-deps","--pull","never","app"]);}
  async waitHealthy(pro=false){for(let attempt=0;attempt<60;attempt++){if(await this.health(pro).catch(()=>false))return;await this.delay(3000);}throw new Error("HEALTH_CHECK_FAILED");}
  start(code){
    if(this.running)return false;
    if(!/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/.test(code))throw new Error("INVALID_CODE");
    this.running=true;
    this.completion=this.upgrade(code).finally(()=>{this.running=false;});return true;
  }
  /** Installed image reference (from .env) and the exact image ID of the running app container. */
  async installed(){
    const env=await readFile(join(this.directory,".env"),"utf8");
    const reference=/^HRIS_IMAGE=(.+)$/m.exec(env)?.[1].trim();
    if(!reference||!imagePattern.test(reference))throw new Error("INSTALLATION_NOT_FOUND");
    const container=String(await this.run([...(await this.composeArgs()),"ps","--all","--quiet","app"])).trim();
    if(!/^[a-f0-9]{12,64}$/.test(container))throw new Error("INSTALLATION_NOT_FOUND");
    const running=String(await this.run(["inspect","--format","{{.Image}}",container])).trim();
    if(!/^sha256:[a-f0-9]{64}$/.test(running))throw new Error("INSTALLATION_NOT_FOUND");
    return {reference,running,env};
  }
  async listBackups(){
    const dir=join(this.directory,"backups");
    try{
      const names=(await readdir(dir)).filter(name=>/^hris-[0-9TZ-]+\.dump$/.test(name)).sort().reverse();
      return Promise.all(names.map(async name=>{const info=await stat(join(dir,name));return {name,size:info.size,createdAt:info.mtime.toISOString()};}));
    }catch{return [];}
  }
  /** pg_dump of the bundled database before anything changes; an external database is the owner's to back up. */
  async backup(env){
    const files=/^COMPOSE_FILE=(.*)$/m.exec(env)?.[1]||"";
    if(files.includes("compose.external.yml"))return null;
    const database=/^HRIS_DB_NAME=([A-Za-z0-9_]+)$/m.exec(env)?.[1]||"hris";
    const dir=join(this.directory,"backups");await mkdir(dir,{recursive:true,mode:0o700});
    const name=`hris-${new Date().toISOString().replace(/[:.]/g,"-")}.dump`;
    await this.runToFile([...(await this.composeArgs()),"exec","-T","postgres","pg_dump","-U","postgres","-Fc",database],join(dir,name));
    const old=(await this.listBackups()).slice(this.keepBackups);
    for(const item of old)await unlink(join(dir,item.name)).catch(()=>{});
    return name;
  }
  status(){return {stage:this.state.stage,code:this.state.code,previousImage:this.state.previousReference||null,version:this.state.image||null,backup:this.state.backup||null};}
  busy(){return this.running||BUSY.includes(this.state.stage);}
  startUpdate(image){
    if(this.busy())return false;
    this.running=true;this.completion=this.switchTo(image,{backup:true}).finally(()=>{this.running=false;});return true;
  }
  startRollback(){
    if(this.busy())return false;
    const target=this.state.previousReference||this.state.previousImage;
    if(!target)throw new Error("NO_PREVIOUS");
    this.running=true;this.completion=this.switchTo(target,{backup:false,rollback:true}).finally(()=>{this.running=false;});return true;
  }
  /** Pull, switch, check health; on failure return to the exact image that was running. */
  async switchTo(target,{backup,rollback=false}){
    // Kept for the failure record: a failed attempt must not lose the last good rollback target.
    const priorReference=this.state.previousReference;
    let previous,switched=false,backupName=null;
    try{
      await this.save({stage:"validating",image:target});
      await this.composeArgs();
      const installed=await this.installed();
      previous=installed;
      if(!rollback&&!allowedUpdate(target,installed.reference,this.official))throw new Error("IMAGE_NOT_ALLOWED");
      if(rollback&&!imagePattern.test(target))throw new Error("IMAGE_NOT_ALLOWED");
      if(backup){await this.save({stage:"backing_up",image:target});backupName=await this.backup(installed.env);}
      await this.save({stage:"downloading",image:target,previousImage:installed.running,backup:backupName});
      if(!target.startsWith("sha256:"))await this.run(["pull",target]);
      await this.save({stage:"restarting",image:target,previousImage:installed.running,backup:backupName});switched=true;
      await this.setImage(target);await this.startApp();
      await this.save({stage:"checking",image:target,previousImage:installed.running,backup:backupName});await this.waitHealthy();
      // The version that was running becomes the rollback target (by tag when it had one).
      const previousReference=installed.reference.startsWith("sha256:")?installed.running:installed.reference;
      await this.save({stage:"complete",image:target,previousImage:installed.running,previousReference,backup:backupName});
    }catch(error){
      let failure=["INSTALLATION_NOT_FOUND","LEGACY_LIFECYCLE_LAYOUT","IMAGE_NOT_ALLOWED"].includes(error.message)?error.message:backupName===null&&backup&&!switched&&this.state.stage==="backing_up"?"BACKUP_FAILED":"UPDATE_FAILED";
      if(switched&&previous){
        try{await this.save({stage:"rolling_back",image:target,previousImage:previous.running});await this.setImage(previous.running);await this.startApp();await this.waitHealthy();await this.setImage(previous.reference);failure="UPDATE_ROLLED_BACK";}
        catch{failure="ROLLBACK_FAILED";}
      }
      await this.save({stage:"failed",code:failure,image:target,previousReference:priorReference,backup:backupName});
    }
  }
  async upgrade(code){
    let previousImage,switched=false,config;
    try{
      await this.save({stage:"validating"});
      await this.composeArgs();
      const env=await readFile(join(this.directory,".env"),"utf8");
      previousImage=/^HRIS_IMAGE=(.+)$/m.exec(env)?.[1].trim();
      if(!previousImage||!imagePattern.test(previousImage))throw new Error("INSTALLATION_NOT_FOUND");
      // Pin the running image, not its mutable tag: pulling :latest must not
      // overwrite the only rollback target.
      const container=String(await this.run([...(await this.composeArgs()),"ps","--all","--quiet","app"])).trim();
      if(!/^[a-f0-9]{12,64}$/.test(container))throw new Error("INSTALLATION_NOT_FOUND");
      const runningImage=String(await this.run(["inspect","--format","{{.Image}}",container])).trim();
      if(!/^sha256:[a-f0-9]{64}$/.test(runningImage))throw new Error("INSTALLATION_NOT_FOUND");
      previousImage=runningImage;
      const response=await this.fetcher(`${this.server}/api/licenses/upgrade`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code}),redirect:"error",signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error("LICENSE_REJECTED");
      const {data:credentials}=await response.json();
      if(credentials?.siteOrigin!==this.origin||!/^inst_[A-Za-z0-9_-]{16,128}$/.test(credentials.username)||typeof credentials.password!=="string"||credentials.password.length<32||!imagePattern.test(credentials.image)||!/^([a-z0-9-]+\.)+[a-z0-9-]+(?::\d{2,5})?$/.test(credentials.registry)||!credentials.image.startsWith(`${credentials.registry}/`))throw new Error("INVALID_DISTRIBUTION");
      config=await mkdtemp(join(this.data,"registry-"));
      await this.run(["--config",config,"login",credentials.registry,"--username",credentials.username,"--password-stdin"],credentials.password);
      await this.save({stage:"downloading",previousImage});
      await this.run(["--config",config,"pull",credentials.image]);
      // Persist the rollback target before changing the installation. Pull never stops the current app.
      await this.save({stage:"restarting",previousImage});switched=true;
      await this.setImage(credentials.image);await this.startApp();
      await this.save({stage:"checking",previousImage});await this.waitHealthy(true);
      await this.save({stage:"complete"});
    }catch(error){
      let failure=["LICENSE_REJECTED","INVALID_DISTRIBUTION","INSTALLATION_NOT_FOUND","LEGACY_LIFECYCLE_LAYOUT"].includes(error.message)?error.message:"UPGRADE_FAILED";
      if(switched&&previousImage){
        try{await this.save({stage:"rolling_back",previousImage});await this.setImage(previousImage);await this.startApp();await this.waitHealthy();failure="UPGRADE_ROLLED_BACK";}
        catch{failure="ROLLBACK_FAILED";}
      }
      await this.save({stage:"failed",code:failure});
    }finally{if(config)await rm(config,{recursive:true,force:true});}
  }
}
