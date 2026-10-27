import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFileSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version='9.0.2',url='https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.7z';
const archiveSha256='4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077';
const cache=path.join(root,'.local-cache','downloads'),archive=path.join(cache,'ffmpeg-9.0.2-essentials_build.7z'),destination=path.join(root,'tools','ffmpeg');
const hash=async file=>{const value=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))value.update(bytes);return value.digest('hex');};
if(process.platform!=='win32')throw new Error('The pinned media tools package targets Windows x64.');
fs.mkdirSync(cache,{recursive:true});
if(!fs.existsSync(archive)){
 const response=await fetch(url,{signal:AbortSignal.timeout(600000)});if(!response.ok||!response.body)throw new Error('Could not download the pinned Windows media tools.');
 const temporary=archive+'.download';await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(temporary,{flags:'w'}));
 if(await hash(temporary)!==archiveSha256)throw new Error('The downloaded media tools failed their pinned SHA-256 check.');fs.renameSync(temporary,archive);
}
if(await hash(archive)!==archiveSha256)throw new Error('The cached media tools failed their pinned SHA-256 check.');
fs.mkdirSync(destination,{recursive:true});
// Extract only named files from the checksum-pinned archive, directly into the tools folder.
const sevenZip=path.join(root,'node_modules','7zip-bin','win','x64','7za.exe');
if(!fs.existsSync(sevenZip))throw new Error('The installer dependency 7zip-bin is missing. Run npm ci.');
execFileSync(sevenZip,['e',archive,`-o${destination}`,'-y','-r','ffmpeg.exe','ffprobe.exe','LICENSE','README.txt'],{windowsHide:true,stdio:'inherit',timeout:120000});
fs.renameSync(path.join(destination,'LICENSE'),path.join(destination,'LICENSE.txt'));
const files={};for(const name of ['ffmpeg.exe','ffprobe.exe','LICENSE.txt','README.txt'])files[name]=await hash(path.join(destination,name));
fs.writeFileSync(path.join(destination,'toolchain.json'),JSON.stringify({version,platform:'win32-x64',url,archiveSha256,files,source:'https://github.com/FFmpeg/FFmpeg/tree/946fcce07b',buildInformation:'https://www.gyan.dev/ffmpeg/builds/'},null,2)+'\n');
console.log(`Prepared bundled FFmpeg/ffprobe ${version}; archive SHA-256 verified.`);
