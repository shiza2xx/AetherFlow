import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

export type AppRuntimePathOptions={isPackaged:boolean;appData:string;executablePath:string;explicitProfile?:string;legacyProfile?:(appData:string,explicitProfile?:string)=>string};

export function runtimeTempDirectory(environment:NodeJS.ProcessEnv=process.env){const configured=environment.AETHERFLOW_TEMP_DIR||environment.TEMP||environment.TMP||os.tmpdir();if(!path.isAbsolute(configured))throw new Error('AetherFlow temporary directory must be an absolute path.');return path.resolve(configured);}

function samePath(left:string,right:string){return process.platform==='win32'?left.toLocaleLowerCase('en-US')===right.toLocaleLowerCase('en-US'):left===right;}

/** Select the profile before Electron initializes sessions or windows. */
export function resolveAppDataRoot(options:AppRuntimePathOptions){
  if(options.explicitProfile){if(!path.isAbsolute(options.explicitProfile))throw new Error('AETHERFLOW_USER_DATA must be an absolute path.');return path.resolve(options.explicitProfile);}
  if(!options.isPackaged)return (options.legacyProfile||((root:string)=>path.join(root,'AetherFlow')))(options.appData);
  const executable=path.resolve(options.executablePath),installDir=path.dirname(executable),volumeRoot=path.parse(installDir).root;
  if(!path.isAbsolute(executable)||samePath(path.resolve(installDir),path.resolve(volumeRoot)))throw new Error('AetherFlow cannot store its local data beside an executable at a volume root. Choose a writable installation folder.');
  const stat=fs.lstatSync(installDir);if(stat.isSymbolicLink())throw new Error('The AetherFlow installation folder redirects through a junction or symbolic link. Choose a regular writable folder.');if(!stat.isDirectory())throw new Error('The AetherFlow installation folder is not a normal directory. Reinstall into a writable folder.');
  const canonical=fs.realpathSync.native(installDir);if(!samePath(canonical,path.resolve(installDir)))throw new Error('The AetherFlow installation folder redirects through a junction or symbolic link. Choose a regular writable folder.');
  return path.join(canonical,'data');
}

/** Prove local data, cache and temp are writable real directories without a fallback. */
export function ensureAppRuntimeDirectories(dataRoot:string){
  const data=path.resolve(dataRoot),root=path.parse(data).root;
  if(samePath(data,root))throw new Error('AetherFlow data cannot be stored directly at a volume root.');
  const result={data,cache:path.join(data,'cache'),temp:path.join(data,'temp'),logs:path.join(data,'logs'),crashDumps:path.join(data,'crash-dumps'),sessionData:path.join(data,'session-data'),updates:path.join(data,'updates')};
  for(const [label,directory] of Object.entries(result)){
    try{fs.mkdirSync(directory,{recursive:true});const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('directory is not a regular folder');const real=fs.realpathSync.native(directory);if(!samePath(real,path.resolve(directory))||!samePath(real,data)&&!real.toLocaleLowerCase('en-US').startsWith(`${data.toLocaleLowerCase('en-US')}${path.sep.toLocaleLowerCase('en-US')}`))throw new Error('directory redirects outside the app data folder');const probe=path.join(real,`.aetherflow-write-check-${process.pid}-${crypto.randomUUID()}`);fs.writeFileSync(probe,'',{flag:'wx'});fs.unlinkSync(probe);}catch(error){const detail=error instanceof Error?error.message:String(error);throw new Error(`AetherFlow needs a writable local ${label} folder at ${directory}: ${detail}. Choose a normal user-writable installation folder.`,{cause:error});}
  }
  return result;
}
