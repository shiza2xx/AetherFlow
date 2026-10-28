import fs from 'node:fs';
import path from 'node:path';
import type {AppSettings} from '../shared/contracts';

export type ProfilePreferences=Pick<AppSettings,'theme'|'locale'|'motion'|'soundEnabled'|'soundVolume'>;
const FILE='profile-preferences-v1.json';
const DEFAULTS:ProfilePreferences={theme:'dark',locale:'en',motion:'full',soundEnabled:true,soundVolume:.28};
const KEYS=['theme','locale','motion','soundEnabled','soundVolume'] as const;

function valid(value:unknown):value is ProfilePreferences{
 if(!value||typeof value!=='object')return false;
 const row=value as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='locale,motion,soundEnabled,soundVolume,theme')return false;
 return (row.theme==='dark'||row.theme==='light')&&(row.locale==='en'||row.locale==='ru')&&(row.motion==='full'||row.motion==='reduced')&&typeof row.soundEnabled==='boolean'&&typeof row.soundVolume==='number'&&Number.isFinite(row.soundVolume)&&row.soundVolume>=0&&row.soundVolume<=1;
}
function sanitized(value:unknown):ProfilePreferences|undefined{if(!value||typeof value!=='object'||Array.isArray(value))return;const input=value as Record<string,unknown>,picked={theme:input.theme,locale:input.locale,motion:input.motion,soundEnabled:input.soundEnabled,soundVolume:input.soundVolume};return valid(picked)?picked:undefined;}
function location(userData:string){return path.join(userData,FILE)}
function read(userData:string):ProfilePreferences|undefined{
 try{const parsed=JSON.parse(fs.readFileSync(location(userData),'utf8'));return sanitized(parsed.preferences);}catch{return undefined;}
}
function write(userData:string,preferences:ProfilePreferences){
 const safe=sanitized(preferences);if(!safe)throw new Error('Profile preferences are invalid.');fs.mkdirSync(userData,{recursive:true});const target=location(userData),temp=`${target}.${process.pid}.${Date.now()}.tmp`;
 fs.writeFileSync(temp,JSON.stringify({schemaVersion:1,preferences:safe},null,2),{flag:'wx',mode:0o600});
 try{fs.renameSync(temp,target);}catch(error){try{fs.rmSync(temp,{force:true});}catch{}throw error;}
}
export function loadProfilePreferences(userData:string,workspaceSettings:AppSettings):ProfilePreferences{
 const current=read(userData);if(current)return current;
 const seeded:ProfilePreferences={theme:workspaceSettings.theme,locale:workspaceSettings.locale,motion:workspaceSettings.motion,soundEnabled:workspaceSettings.soundEnabled??DEFAULTS.soundEnabled,soundVolume:workspaceSettings.soundVolume??DEFAULTS.soundVolume};
 write(userData,seeded);return seeded;
}
export function updateProfilePreferences(userData:string,patch:Partial<ProfilePreferences>,workspaceSettings:AppSettings):ProfilePreferences{
 const current=read(userData)||loadProfilePreferences(userData,workspaceSettings),next=mergeProfilePreferences(current,patch);write(userData,next);return next;
}
export function persistSettingsWithProfile(userData:string,profilePatch:Partial<ProfilePreferences>,workspacePatch:Partial<AppSettings>,workspaceSettings:AppSettings,persistWorkspace:(patch:Partial<AppSettings>)=>AppSettings){
 const previous=loadProfilePreferences(userData,workspaceSettings);mergeProfilePreferences(previous,profilePatch);const profile=updateProfilePreferences(userData,profilePatch,workspaceSettings);
 try{return {settings:persistWorkspace(workspacePatch),profile};}
 catch(error){write(userData,previous);throw error;}
}
export function mergeProfilePreferences(current:ProfilePreferences,patch:Partial<ProfilePreferences>):ProfilePreferences{
 const safeCurrent=sanitized(current);if(!safeCurrent)throw new Error('Profile preferences are invalid.');const allowed:Partial<ProfilePreferences>={};for(const key of KEYS)if(Object.hasOwn(patch,key))allowed[key]=patch[key] as never;const next={...safeCurrent,...allowed};if(!valid(next))throw new Error('Profile preferences are invalid.');return next;
}
export function withProfilePreferences(settings:AppSettings,preferences:ProfilePreferences):AppSettings{const safe=sanitized(preferences);if(!safe)throw new Error('Profile preferences are invalid.');return {...settings,...safe};}
