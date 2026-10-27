import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function alive(pid){try{process.kill(pid,0);return true;}catch(error){return error?.code!=='ESRCH';}}
function safeLocalDirectory(value){const resolved=path.resolve(value);if(!path.isAbsolute(resolved)||!fs.statSync(resolved).isDirectory()||fs.lstatSync(resolved).isSymbolicLink()||fs.realpathSync.native(resolved)!==resolved)throw new Error('Update target must be an existing regular installation folder.');return resolved;}
async function identity(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Staged installer must be a regular file.');const hash=crypto.createHash('sha512');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return{size:stat.size,sha512:hash.digest('hex')};}
const [parentText,installerText,installText,sizeText,hashText]=process.argv.slice(2);const parentPid=Number(parentText),installer=path.resolve(installerText||''),installDirectory=safeLocalDirectory(installText||''),expected={size:Number(sizeText),sha512:String(hashText||'').toLowerCase()};
if(!Number.isSafeInteger(parentPid)||parentPid<1||!path.isAbsolute(installer)||!Number.isSafeInteger(expected.size)||expected.size<1||!/^[a-f0-9]{128}$/.test(expected.sha512))throw new Error('Update launcher received invalid local process or installer arguments.');
const first=await identity(installer);if(first.size!==expected.size||first.sha512!==expected.sha512)throw new Error('Staged update installer failed its signed identity check.');
process.stdout.write('AETHERFLOW_UPDATE_READY\n');
const deadline=Date.now()+180_000;while(alive(parentPid)){if(Date.now()>deadline)throw new Error('AetherFlow did not close within the update launch window.');await new Promise(resolve=>setTimeout(resolve,250));}
const final=await identity(installer);if(final.size!==expected.size||final.sha512!==expected.sha512)throw new Error('Staged update installer changed before helper handoff.');
const args=[`/D=${installDirectory}`];const child=spawn(installer,args,{cwd:path.dirname(installer),detached:true,stdio:'ignore',windowsHide:false});child.unref();
