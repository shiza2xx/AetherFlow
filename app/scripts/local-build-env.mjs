import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildEnvironment(source=process.env){
 const cache=path.join(repo,'.local-cache'),paths={temp:path.join(cache,'temp'),npm:path.join(cache,'npm'),electron:path.join(cache,'electron'),electronBuilder:path.join(cache,'electron-builder'),nuget:path.join(cache,'nuget')};
 for(const directory of Object.values(paths))fs.mkdirSync(directory,{recursive:true});
 return {...source,CSC_IDENTITY_AUTO_DISCOVERY:'false',ELECTRON_BUILDER_COMPRESSION_LEVEL:source.ELECTRON_BUILDER_COMPRESSION_LEVEL||'3',TEMP:paths.temp,TMP:paths.temp,TMPDIR:paths.temp,npm_config_cache:paths.npm,ELECTRON_CACHE:paths.electron,ELECTRON_BUILDER_CACHE:paths.electronBuilder,NUGET_PACKAGES:paths.nuget,AETHERFLOW_LOCAL_BUILD_CACHE:cache};
}
export const repoRoot=repo;
