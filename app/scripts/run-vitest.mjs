import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';

// AETHERFLOW_TEST_TMPDIR explicitly overrides the safe ignored D: workspace temp root.
const workspace=path.resolve(process.cwd());
const configured=process.env.AETHERFLOW_TEST_TMPDIR?.trim();
const defaultTempParent=path.join(workspace,'evidence','q');
const tempRoot=configured?path.resolve(configured):path.join(defaultTempParent,crypto.randomUUID());
const ensureNoRedirect=(directory)=>{let current=path.parse(directory).root;for(const part of path.relative(current,directory).split(path.sep).filter(Boolean)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error(`Test temp path cannot traverse a symlink: ${current}`);}};
if(!configured&&!tempRoot.startsWith(defaultTempParent+path.sep))throw new Error('Default Vitest temp escaped the private per-run QA root.');
ensureNoRedirect(path.dirname(tempRoot));fs.mkdirSync(tempRoot,{recursive:true});
const env={...process.env,TMPDIR:tempRoot,TMP:tempRoot,TEMP:tempRoot,AETHERFLOW_TEST_TEMP_ROOT:tempRoot};
const cli=path.join(workspace,'node_modules','vitest','vitest.mjs');
const result=spawnSync(process.execPath,[cli,'run',...process.argv.slice(2)],{cwd:workspace,env,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
if(result.status===0&&!configured){const root=path.resolve(defaultTempParent);if(!tempRoot.startsWith(root+path.sep)||fs.lstatSync(tempRoot).isSymbolicLink())throw new Error('Refusing to clean a Vitest temp outside the owned QA root.');fs.rmSync(tempRoot,{recursive:true,force:true});}
else if(result.status!==0)console.error(`Vitest temp retained for diagnosis: ${tempRoot}`);
process.exitCode=result.status??1;
