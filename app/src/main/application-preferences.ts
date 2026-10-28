import fs from 'node:fs';
import path from 'node:path';
export type ApplicationPreferences={autoCheckUpdates:boolean;languageSelected:boolean};
const file=(root:string)=>path.join(root,'application-preferences-v1.json');
export function saveApplicationPreferences(root:string,value:ApplicationPreferences){
 if(typeof value.autoCheckUpdates!=='boolean'||typeof value.languageSelected!=='boolean')throw new Error('Application preferences are invalid.');
 fs.mkdirSync(root,{recursive:true});const target=file(root),temp=`${target}.${process.pid}.${Date.now()}.tmp`;
 try{fs.writeFileSync(temp,JSON.stringify({schemaVersion:1,preferences:{autoCheckUpdates:value.autoCheckUpdates,languageSelected:value.languageSelected}},null,2),{flag:'wx',mode:0o600});fs.renameSync(temp,target);}catch(error){try{fs.rmSync(temp,{force:true});}catch{}throw error;}
 return value;
}
export function loadApplicationPreferences(root:string,legacy:{autoCheckUpdates?:boolean}={}):ApplicationPreferences{
 try{const parsed=JSON.parse(fs.readFileSync(file(root),'utf8'));if(parsed.schemaVersion===1&&typeof parsed.preferences?.autoCheckUpdates==='boolean'&&typeof parsed.preferences?.languageSelected==='boolean')return {autoCheckUpdates:parsed.preferences.autoCheckUpdates,languageSelected:parsed.preferences.languageSelected};return {autoCheckUpdates:false,languageSelected:false};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return {autoCheckUpdates:false,languageSelected:false};}
 return saveApplicationPreferences(root,{autoCheckUpdates:legacy.autoCheckUpdates!==false,languageSelected:false});
}
export function patchApplicationPreferences(current:ApplicationPreferences,patch:Record<string,unknown>){
 const next={...current};for(const key of ['autoCheckUpdates','languageSelected'] as const)if(Object.hasOwn(patch,key)){if(typeof patch[key]!=='boolean')throw new Error('Application preferences are invalid.');next[key]=patch[key] as boolean;}return next;
}
