import { spawn } from "node:child_process";
const run=file=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{stdio:"inherit",shell:false});const term=()=>child.kill("SIGTERM"),int=()=>child.kill("SIGINT");process.on("SIGTERM",term);process.on("SIGINT",int);child.on("error",reject);child.on("exit",code=>{process.off("SIGTERM",term);process.off("SIGINT",int);code===0?resolve():reject(new Error("Process failed"));});});
try {await run("db-setup.cjs");await run("server.js");} catch {console.error("Startup failed. Check database connectivity and the database schema message above.");process.exitCode=1;}

