import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function resolveMcpTokenPath({appData=process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),canonicalDirectory=process.env.AETHERFLOW_USER_DATA,legacyDirectory=process.env.ATELIER_USER_DATA}={}){
  const canonical=canonicalDirectory?.trim(),legacy=legacyDirectory?.trim();
  if(canonical&&legacy&&path.resolve(canonical).toLocaleLowerCase('en-US')!==path.resolve(legacy).toLocaleLowerCase('en-US'))throw new Error('AETHERFLOW_USER_DATA and legacy ATELIER_USER_DATA point to different profiles. Set only the canonical profile path.');
  const explicit=canonical||legacy;
  if(explicit){if(!path.isAbsolute(explicit))throw new Error('AetherFlow user data directory must be absolute.');return path.join(path.resolve(explicit),'mcp-token');}
  const root=path.resolve(appData),newProfile=path.join(root,'AetherFlow'),oldProfile=path.join(root,'project-atelier');
  const populated=(directory)=>['workspace/aetherflow.sqlite','workspace/atelier.sqlite','active-workspace.json','workspace-catalog-v1.json','mcp-token'].some(relative=>{try{const file=path.join(directory,relative),stat=fs.lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&fs.realpathSync.native(file)===file;}catch{return false;}});
  const hasNew=populated(newProfile),hasOld=populated(oldProfile);
  if(hasNew&&hasOld)throw new Error(`Both AetherFlow and legacy Project Atelier profiles contain data. Set AETHERFLOW_USER_DATA explicitly: ${newProfile} or ${oldProfile}.`);
  return path.join(hasOld?oldProfile:newProfile,'mcp-token');
}
