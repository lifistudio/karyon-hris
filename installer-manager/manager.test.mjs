import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {UpgradeManager,replaceImage,validServer} from "./manager.mjs";

test("installer manager validates destinations and preserves environment secrets",()=>{
  assert.equal(validServer("https://license.example"),"https://license.example");
  for(const url of ["http://license.example","https://user:pass@license.example","https://license.example/path"])assert.throws(()=>validServer(url));
  assert.equal(replaceImage("HRIS_IMAGE=ghcr.io/acme/hris:1\nENCRYPTION_KEY=keep-me\n","registry.example/hris-pro:2"),"HRIS_IMAGE=registry.example/hris-pro:2\nENCRYPTION_KEY=keep-me\n");
  assert.throws(()=>replaceImage("HRIS_IMAGE=old","evil\nENCRYPTION_KEY=new"));
});

for(const scenario of ["success","pull-failure","health-failure","wrong-site"]){
  test(`private image upgrade: ${scenario}`,async()=>{
    const directory=await mkdtemp(join(tmpdir(),"hris-manager-test-")),calls=[];
    const original="HRIS_IMAGE=ghcr.io/acme/hris:1\nENCRYPTION_KEY=unchanged\nCOMPOSE_FILE=compose.image.yml;compose.manager.yml\n";
    await writeFile(join(directory,".env"),original);
    let healthyCalls=0;
    const manager=new UpgradeManager({directory,data:join(directory,"data"),licenseServer:"https://license.example",siteOrigin:"https://hr.example",project:"hris",delay:async()=>{},
      fetcher:async()=>Response.json({data:{registry:"registry.example",image:"registry.example/hris-pro:2",username:"inst_installation_12345678",password:"s".repeat(40),siteOrigin:scenario==="wrong-site"?"https://other.example":"https://hr.example"}}),
      run:async(args,input)=>{calls.push({args,input});if(scenario==="pull-failure"&&args.includes("pull"))throw new Error("pull failed");if(args.includes("ps"))return "a".repeat(64);if(args[0]==="inspect")return `sha256:${"b".repeat(64)}`;return "";},
      health:async pro=>{healthyCalls++;return !(scenario==="health-failure"&&pro);},
    });
    try{
      await manager.initialize();assert.equal(manager.start("ABCD-EFGH-JKLM-NPQR"),true);assert.equal(manager.start("ABCD-EFGH-JKLM-NPQR"),false);
      await manager.completion;
      const env=await readFile(join(directory,".env"),"utf8");assert.match(env,/ENCRYPTION_KEY=unchanged/);
      assert.equal(JSON.stringify(manager.state).includes("ssss"),false);
      for(const call of calls){assert.equal(call.args.includes("down"),false);assert.equal(call.args.includes("--volumes"),false);assert.equal(call.args.join(" ").includes("ssss"),false);}
      if(scenario==="success"){
        assert.equal(manager.state.stage,"complete");assert.match(env,/HRIS_IMAGE=registry.example\/hris-pro:2/);
        assert.ok(calls.find(call=>call.args.includes("--no-deps")&&call.args.at(-1)==="app"));
        assert.ok(calls.find(call=>call.args.includes("--password-stdin")&&call.input==="s".repeat(40)));
      }else{
        assert.equal(manager.state.stage,"failed");assert.equal(env,scenario==="health-failure"?replaceImage(original,`sha256:${"b".repeat(64)}`):original);
        if(scenario==="health-failure"){assert.equal(manager.state.code,"UPGRADE_ROLLED_BACK");assert.equal(calls.filter(call=>call.args.includes("up")).length,2);assert.ok(healthyCalls>1);}
        else assert.equal(calls.filter(call=>call.args.includes("up")).length,0);
      }
    }finally{await rm(directory,{recursive:true,force:true});}
  });
}

for(const stage of ["downloading","restarting","checking","rolling_back"]){
  test(`interrupted upgrade recovers from ${stage} without changing secrets or deleting volumes`,async()=>{
    const directory=await mkdtemp(join(tmpdir(),"hris-manager-recovery-")),data=join(directory,"state"),calls=[];
    const previousImage=`sha256:${"c".repeat(64)}`;
    await mkdir(data);
    await writeFile(join(directory,".env"),"HRIS_IMAGE=registry.example/pro:latest\nENCRYPTION_KEY=keep-existing\n");
    await writeFile(join(data,"status.json"),JSON.stringify({stage,previousImage}));
    // Simulate an interrupted checkpoint write. The complete checkpoint wins.
    await writeFile(join(data,"status.json.tmp"),'{"stage":');
    const manager=new UpgradeManager({directory,data,licenseServer:"https://license.example",siteOrigin:"https://hr.example",project:"hris",run:async args=>{calls.push(args);return "";},health:async()=>true});
    try{
      await manager.initialize();
      assert.equal(manager.state.stage,"failed");
      assert.equal(manager.state.code,stage==="downloading"?"INTERRUPTED":"INTERRUPTED_ROLLED_BACK");
      const env=await readFile(join(directory,".env"),"utf8");
      assert.match(env,/ENCRYPTION_KEY=keep-existing/);
      if(stage!=="downloading")assert.ok(env.includes(`HRIS_IMAGE=${previousImage}`));
      assert.equal(calls.length,stage==="downloading"?0:1);
      for(const args of calls){assert.ok(args.includes("--no-deps"));assert.equal(args.at(-1),"app");assert.ok(!args.includes("down"));}
      assert.deepEqual(JSON.parse(await readFile(join(data,"status.json"),"utf8")),manager.state);
    }finally{await rm(directory,{recursive:true,force:true});}
  });
}

for(const scenario of ["success","health-failure","not-allowed","external-db"]){
  test(`version update: ${scenario}`,async()=>{
    const {allowedUpdate}=await import("./manager.mjs");
    const directory=await mkdtemp(join(tmpdir(),"hris-update-test-")),calls=[],files=[];
    const compose=scenario==="external-db"?"compose.image.yml:compose.manager.yml:compose.external.yml":"compose.image.yml:compose.manager.yml";
    await writeFile(join(directory,".env"),`HRIS_IMAGE=ghcr.io/lifistudio/hris:1.0.0\nENCRYPTION_KEY=unchanged\nHRIS_DB_NAME=hris\nCOMPOSE_FILE=${compose}\n`);
    let switchedTo="";
    const manager=new UpgradeManager({directory,data:join(directory,"data"),licenseServer:"https://license.example",siteOrigin:"https://hr.example",project:"hris",delay:async()=>{},
      run:async(args)=>{calls.push(args);if(args.includes("ps"))return "a".repeat(64);if(args[0]==="inspect")return `sha256:${"b".repeat(64)}`;if(args.includes("up"))switchedTo=(await readFile(join(directory,".env"),"utf8")).match(/HRIS_IMAGE=(.*)/)[1];return "";},
      runToFile:async(args,file)=>{files.push(args);await writeFile(file,"PGDMP");},
      health:async()=>!(scenario==="health-failure"&&switchedTo.endsWith(":1.1.0")),
    });
    const target=scenario==="not-allowed"?"evil.example/hris:1.1.0":"ghcr.io/lifistudio/hris:1.1.0";
    assert.equal(manager.startUpdate(target),true);
    await manager.completion;
    const env=await readFile(join(directory,".env"),"utf8");
    assert.match(env,/ENCRYPTION_KEY=unchanged/);
    if(scenario==="success"){
      assert.equal(manager.state.stage,"complete");
      assert.match(env,/HRIS_IMAGE=ghcr.io\/lifistudio\/hris:1.1.0/);
      assert.equal(files.length,1,"bundled database backed up first");
      assert.deepEqual(files[0].slice(-8),["exec","-T","postgres","pg_dump","-U","postgres","-Fc","hris"]);
      assert.equal((await manager.listBackups()).length,1);
      assert.equal(manager.status().previousImage,"ghcr.io/lifistudio/hris:1.0.0");
      // Rollback returns to the previous tag; a second rollback goes forward again.
      assert.equal(manager.startRollback(),true);await manager.completion;
      assert.match(await readFile(join(directory,".env"),"utf8"),/HRIS_IMAGE=ghcr.io\/lifistudio\/hris:1.0.0/);
      assert.equal(manager.status().previousImage,"ghcr.io/lifistudio/hris:1.1.0");
    }
    if(scenario==="health-failure"){
      assert.equal(manager.state.code,"UPDATE_ROLLED_BACK");
      assert.match(env,/HRIS_IMAGE=ghcr.io\/lifistudio\/hris:1.0.0/,"installation returned to the previous version");
    }
    if(scenario==="not-allowed"){
      assert.equal(manager.state.code,"IMAGE_NOT_ALLOWED");
      assert.equal(calls.some(a=>a.includes("pull")),false);
    }
    if(scenario==="external-db"){assert.equal(manager.state.stage,"complete");assert.equal(files.length,0,"external database is not dumped");}
    assert.equal(allowedUpdate("ghcr.io/lifistudio/hris:2.0.0","ghcr.io/lifistudio/hris:1.0.0","ghcr.io/lifistudio/hris"),true);
    assert.equal(allowedUpdate("ghcr.io/lifistudio/hris@sha256:abc","ghcr.io/lifistudio/hris:1.0.0","ghcr.io/lifistudio/hris"),false);
    await rm(directory,{recursive:true,force:true});
  });
}
