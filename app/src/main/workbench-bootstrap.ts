import fs from 'node:fs';
import path from 'node:path';
import type {Locale} from '../shared/i18n';
import {workspaceAgentContext, type WorkspaceAgentOwner} from './workspace-agent-context';
import {atelierSkillCatalog} from '../shared/domain';
import {hasInstalledSkillPackage,skillPackageFiles,snapshotSkillFiles} from './skill-closure';

const specs=[
 ['aetherflow-storage','docs/skills/aetherflow-storage'],
 ['aetherflow-character-pipeline','docs/skills/aetherflow-character-pipeline'],
 ['aetherflow-model-workbench','docs/skills/aetherflow-model-workbench'],
 ['aetherflow-mesh-repair','docs/skills/aetherflow-mesh-repair'],
 ['aetherflow-texture-repair','docs/skills/aetherflow-texture-repair'],
 ['aetherflow-character-assembly-rig','docs/skills/aetherflow-character-assembly-rig'],
] as const;

export function ensureWorkbenchSkills(appRoot:string,work:string,locale:Locale='en',owner:WorkspaceAgentOwner={kind:'character'}){
 const root=path.resolve(work);fs.mkdirSync(root,{recursive:true});
 for(const directory of [root,path.join(root,'.agents'),path.join(root,'.agents','skills')]){
  if(fs.existsSync(directory)&&(fs.lstatSync(directory).isSymbolicLink()||!fs.statSync(directory).isDirectory()||fs.realpathSync.native(directory)!==path.resolve(directory)))throw new Error('Character Skill directory is unsafe.');
  if(!fs.existsSync(directory))fs.mkdirSync(directory);
 }
 for(const [id,skillPath] of specs){
  const source=path.join(appRoot,...skillPath.split('/')),target=path.join(root,'.agents','skills',id);
  if(!fs.existsSync(source))throw new Error(`Required workbench Skill is missing: ${id}.`);
  if(fs.existsSync(target)){
   const entry=path.join(target,'SKILL.md');
   if(fs.lstatSync(target).isSymbolicLink()||!fs.statSync(target).isDirectory()||!fs.existsSync(entry)||fs.lstatSync(entry).isSymbolicLink()||!fs.statSync(entry).isFile()||fs.realpathSync.native(target)!==target)throw new Error(`Installed request Skill ${id} is unsafe or incomplete.`);
   const skill=atelierSkillCatalog.find(item=>item.id===id);if(!skill)throw new Error(`Workbench Skill ${id} is not registered in Atelier.`);
   const packageFiles=skillPackageFiles(appRoot,skill);if(packageFiles&&hasInstalledSkillPackage(root,skill,packageFiles))continue;
   const staging=fs.mkdtempSync(path.join(root,'.aetherflow-skill-additions-'));try{snapshotSkillFiles(appRoot,skill,staging);const staged=path.join(staging,'.agents','skills',id);const merge=(from:string,to:string)=>{for(const entry of fs.readdirSync(from,{withFileTypes:true})){const src=path.join(from,entry.name),dst=path.join(to,entry.name);if(entry.isSymbolicLink())throw new Error('Installed Skill package contains a symbolic link.');if(entry.isDirectory()){if(fs.existsSync(dst)){if(fs.lstatSync(dst).isSymbolicLink()||!fs.statSync(dst).isDirectory())throw new Error('Installed Skill addition collides with an unsafe path.');merge(src,dst);}else fs.cpSync(src,dst,{recursive:true,dereference:false});}else if(!fs.existsSync(dst))fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);}};merge(staged,target);}finally{fs.rmSync(staging,{recursive:true,force:true});}
   continue;
  }
  const skill=atelierSkillCatalog.find(item=>item.id===id);if(!skill)throw new Error(`Workbench Skill ${id} is not registered in Atelier.`);
  snapshotSkillFiles(appRoot,skill,root);
 }
 const bootstrapPath=path.join(root,'AGENTS.md'),start='<!-- aetherflow-workbench-bootstrap:start -->',end='<!-- aetherflow-workbench-bootstrap:end -->',legacyStart='<!-- atelier-workbench-bootstrap:start -->',legacyEnd='<!-- atelier-workbench-bootstrap:end -->';
 const bootstrap=`${start}\n${workspaceAgentContext(locale,owner)}\n${end}`;
 if(fs.existsSync(bootstrapPath)){
  const stat=fs.lstatSync(bootstrapPath);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(bootstrapPath)!==bootstrapPath)throw new Error('Workspace AGENTS.md bootstrap path is unsafe.');
  let content=fs.readFileSync(bootstrapPath,'utf8');
  const block=(value:string,markerStart:string,markerEnd:string)=>{const first=value.indexOf(markerStart),last=first<0?-1:value.indexOf(markerEnd,first+markerStart.length);if(first<0&&last<0)return null;if(first<0||last<0)throw new Error('Workspace AGENTS.md contains an incomplete managed bootstrap marker.');return {first,lastEnd:last+markerEnd.length};};
  const canonical=block(content,start,end),legacy=block(content,legacyStart,legacyEnd);
  if(canonical){content=`${content.slice(0,canonical.first)}${bootstrap}${content.slice(canonical.lastEnd)}`;const old=block(content,legacyStart,legacyEnd);if(old)content=`${content.slice(0,old.first)}${content.slice(old.lastEnd)}`;}
  else if(legacy)content=`${content.slice(0,legacy.first)}${bootstrap}${content.slice(legacy.lastEnd)}`;
  else content=`${content.trimEnd()}\n\n${bootstrap}\n`;
  fs.writeFileSync(bootstrapPath,content,{flag:'w'});
 }else fs.writeFileSync(bootstrapPath,`${bootstrap}\n`,{flag:'wx',mode:0o600});
 return {workspace:root,skills:specs.map(([id])=>id),bootstrap:bootstrapPath};
}
