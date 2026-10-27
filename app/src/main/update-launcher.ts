import {spawn,type ChildProcess, type SpawnOptions} from 'node:child_process';
import path from 'node:path';

export function startUpdateLauncher(options:{electronExecutable:string;helperScript:string;parentPid:number;installerPath:string;installDirectory:string;expected:{size:number;sha512:string};spawnProcess?:(command:string,args:string[],options:SpawnOptions)=>ChildProcess}){
 const {electronExecutable,helperScript,parentPid,installerPath,installDirectory,expected}=options;if(!path.isAbsolute(electronExecutable)||!path.isAbsolute(helperScript)||!path.isAbsolute(installerPath)||!path.isAbsolute(installDirectory)||!Number.isSafeInteger(parentPid)||parentPid<1||!Number.isSafeInteger(expected.size)||expected.size<1||!/^[a-f0-9]{128}$/i.test(expected.sha512))throw new Error('Update launcher arguments must use absolute local paths, a valid process id and signed artifact identity.');
 const child=(options.spawnProcess||spawn)(electronExecutable,[helperScript,String(parentPid),installerPath,installDirectory,String(expected.size),expected.sha512],{cwd:path.dirname(electronExecutable),detached:true,stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});return child;
}
