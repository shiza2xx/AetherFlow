// Started by an owned .cmd file in a real Windows console. No prompt, stdin
// injection or exec subcommand: the person pastes their request into Codex.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const file=process.argv[2];
try{
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  if(typeof config.command!=='string'||!Array.isArray(config.args)||config.args.some(arg=>typeof arg!=='string')||typeof config.cwd!=='string')throw new Error('Invalid Atelier session configuration.');
  const env={...process.env};
  // A normal Windows CMD session has no TERM. Do not inherit the agent's
  // redirected TERM=dumb setting into an actual interactive console.
  if(process.platform==='win32'&&env.TERM?.toLowerCase()==='dumb')delete env.TERM;
  for(const key of ['AETHERFLOW_USER_DATA','AETHERFLOW_MCP_PORT','ATELIER_USER_DATA','ATELIER_MCP_PORT'])if(typeof config.env?.[key]==='string')env[key]=config.env[key];
  process.chdir(config.cwd);
  if(typeof config.receiptFile==='string'){
    const target=path.resolve(config.cwd,config.receiptFile);
    const receipt={schemaVersion:1,pid:process.pid,startedAtMs:Date.now(),cwd:path.resolve(config.cwd),requestId:typeof config.requestId==='string'?config.requestId:null};
    const temporary=`${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify(receipt),{flag:'wx',mode:0o600});
    fs.renameSync(temporary,target);
  }
  const child=spawn(config.command,config.args,{cwd:config.cwd,env,stdio:'inherit',shell:false,windowsHide:false});
  const clean=()=>{try{fs.rmSync(file,{force:true});}catch{}};
  child.once('error',error=>{console.error(`Codex: ${error.message}`);clean();process.exitCode=1;});
  child.once('exit',(code,signal)=>{clean();process.exitCode=code??(signal?1:0);});
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
