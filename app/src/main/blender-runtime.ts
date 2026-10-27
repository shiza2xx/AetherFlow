import fs from 'node:fs';import path from 'node:path';

function nativeBlender(file:string){
 try{if(path.basename(file).toLowerCase()!=='blender.exe'||!fs.statSync(file).isFile())return false;const head=Buffer.alloc(2),fd=fs.openSync(file,'r');try{return fs.readSync(fd,head,0,2,0)===2&&head.toString('ascii')==='MZ';}finally{fs.closeSync(fd);}}catch{return false;}
}
/** Bounded local discovery; no drive crawling, CLI launches, downloads or persisted developer-machine paths. */
export function resolveBlenderExecutable(configured:string,roots:string[],env:NodeJS.ProcessEnv=process.env){
 if(configured&&nativeBlender(configured))return configured;
 for(const root of [...new Set(roots.filter(Boolean))]){
  for(const direct of [path.join(root,'tools','blender','blender.exe'),path.join(root,'blender.exe')])if(nativeBlender(direct))return direct;
  const tools=path.join(root,'tools');let folders:string[]=[];try{folders=fs.readdirSync(tools,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^blender(?:[-_. ]|$)/i.test(e.name)).map(e=>e.name).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).slice(0,32);}catch{}
  for(const folder of folders){const file=path.join(tools,folder,'blender.exe');if(nativeBlender(file))return file;}
 }
 const installationRoots=[env.ProgramW6432,env.ProgramFiles].filter(Boolean) as string[];
 for(const root of installationRoots){const foundation=path.join(root,'Blender Foundation');let folders:string[]=[];try{folders=fs.readdirSync(foundation).filter(n=>/^Blender /i.test(n)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).slice(0,32);}catch{}for(const folder of folders){const file=path.join(foundation,folder,'blender.exe');if(nativeBlender(file))return file;}}
 for(const directory of (env.PATH||'').split(path.delimiter).filter(Boolean)){const file=path.join(directory,'blender.exe');if(nativeBlender(file))return file;}
 return '';
}
