import fs from 'node:fs';
import path from 'node:path';

function hasProfileData(directory:string){
  return ['workspace/aetherflow.sqlite','workspace/atelier.sqlite','active-workspace.json','workspace-catalog-v1.json','mcp-token'].some(name=>{
    try{const stat=fs.lstatSync(path.join(directory,name));return stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0;}catch{return false;}
  });
}

/** Resolve the new profile name while keeping the user's existing profile authoritative. */
export function resolveAetherFlowUserData(appData:string,explicitDirectory?:string){
  if(explicitDirectory){if(!path.isAbsolute(explicitDirectory))throw new Error('Custom user data directory must be absolute.');return path.resolve(explicitDirectory);}
  const canonical=path.join(appData,'AetherFlow'),legacy=path.join(appData,'project-atelier');
  const canonicalHasData=hasProfileData(canonical),legacyHasData=hasProfileData(legacy);
  if(canonicalHasData&&legacyHasData)throw new Error(`Both AetherFlow and legacy Project Atelier profiles contain workspace data. Choose one explicitly before continuing: ${canonical} or ${legacy}.`);
  if(legacyHasData)return legacy;
  return canonical;
}
