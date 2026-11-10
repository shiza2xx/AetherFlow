import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {ensureWorkbenchSkills} from './workbench-bootstrap';
import {workspaceAgentContext} from './workspace-agent-context';
import {assetProductionPrompt,assetStagePrompt} from '../shared/asset-prompt';
import {AssetCatalogInput} from './asset-production';

describe('asset job agent bootstrap',()=>{
 it('gives current managed and copied prompts narrow precedence over an unchanged old Skill snapshot',()=>{
  const parent=path.resolve('evidence/assets-production-20261029');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'asset-agent-old-snapshot-'));
  try{
   const owner={kind:'assetJob' as const,id:'job-legacy',name:'House'};
   const installed=ensureWorkbenchSkills(process.cwd(),root,'en',owner);
   const snapshot=path.join(root,'.agents','skills','aetherflow-asset-pipeline','references','composition.md');
   const olderSnapshot='Prior copied guidance: create a separate wall-with-window master for every opening.';
   fs.writeFileSync(snapshot,olderSnapshot);
   const current:any={
    job:{id:'job-legacy',revision:4,name:'House',data:{mode:'composite',stage:'composition',target:'House with windows',sourceArtifactId:'source-house',catalogStatus:'accepted'}},
    items:[
     {id:'solid-wall',name:'Solid wall',data:{route:'module',viewType:'wall',views:['front','side'],depthEnabled:false,sourceArtifactIds:['source-house']}},
     {id:'standalone-window',name:'Standalone window',data:{route:'module',viewType:'window',views:['front','side'],depthEnabled:false,sourceArtifactIds:['source-house']}},
     {id:'legacy-window-wall',name:'Windowed wall',data:{route:'module',viewType:'wall',views:['front','side'],depthEnabled:false,sourceArtifactIds:['source-house']}},
    ],
    workflow:{id:'workflow-legacy',revision:9,data:{slots:[],instances:[],catalogAssumptions:[]}},
   };
   for(const locale of ['en','ru'] as const){
    const bootstrap=ensureWorkbenchSkills(process.cwd(),root,locale,owner).bootstrap;
    const managed=fs.readFileSync(bootstrap,'utf8'),agent=workspaceAgentContext(locale,owner);
    const composition=assetStagePrompt(locale,current,{stage:'composition'});
    const windowImage=assetStagePrompt(locale,current,{stage:'images',itemId:'standalone-window',role:'image:front'});
    const legacyWallImage=assetStagePrompt(locale,current,{stage:'images',itemId:'legacy-window-wall',role:'image:front'});
    for(const text of [managed,agent,composition,windowImage,legacyWallImage]){
     expect(text).toMatch(/current request.*latest user.confirmed choice|текущие инструкции этого запроса.*последним подтверждённым пользователем решением/i);
     expect(text).toMatch(/older.*Skill snapshot.*conflict.*follow this request|старый снимок Skill.*расходятся.*следуйте текущему запросу/i);
     expect(text).toMatch(/does not mean the old snapshot has been updated|не означает, что старый снимок обновлён/i);
     expect(text).toMatch(/do not automatically change.*accepted items.*human review|не изменяйте.*автоматически принятые детали.*проверки человеком/i);
    }
    expect(composition).toMatch(/one continuous solid wall master.*separate window master|один сплошн.*master стены.*отдельный master window/i);
    expect(windowImage).toMatch(/simple, uniform glass base color|простой равномерный базовый цвет стекла/i);
    expect(legacyWallImage).toMatch(/simple, uniform glass base color|простой равномерный базовый цвет стекла/i);
    expect(fs.readFileSync(snapshot,'utf8')).toBe(olderSnapshot);
   }
   expect(installed.skills).toEqual(['aetherflow-asset-pipeline']);
   expect(fs.readFileSync(snapshot,'utf8')).toBe(olderSnapshot);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it('installs only the canonical asset package and writes localized job guidance',()=>{
  const parent=path.resolve('evidence/assets-production-20261029');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'asset-agent-'));
  try{
   const result=ensureWorkbenchSkills(process.cwd(),root,'ru',{kind:'assetJob',id:'example',name:'House'});
   expect(result.skills).toEqual(['aetherflow-asset-pipeline']);
   expect(fs.existsSync(path.join(root,'.agents','skills','aetherflow-asset-pipeline','SKILL.md'))).toBe(true);
   const installedSkill=path.join(root,'.agents','skills','aetherflow-asset-pipeline','SKILL.md');
   expect(fs.readFileSync(installedSkill,'utf8')).toBe(fs.readFileSync(path.resolve('docs/skills/aetherflow-asset-pipeline/SKILL.md'),'utf8'));
   expect(fs.readFileSync(installedSkill,'utf8')).toContain('catalogProposal');
   const example=path.join(root,'.agents','skills','aetherflow-asset-pipeline','references','depth-style-example.png');
   expect(fs.readFileSync(example)).toEqual(fs.readFileSync(path.resolve('docs/skills/aetherflow-ai-depth-maps/references/depth-style-example.png')));
   expect(fs.existsSync(path.join(root,'.agents','skills','aetherflow-asset-pipeline','references','depth-generation.md'))).toBe(true);

   expect(fs.existsSync(path.join(root,'.agents','skills','atelier-asset-pipeline'))).toBe(false);
   const context=fs.readFileSync(result.bootstrap,'utf8');
   expect(context).toContain('asset_job_get');
   expect(context).toContain('asset_job_catalog_submit');
   expect(context).toContain('workflow');
   expect(context).toContain('asset_job_return_submit');
   expect(context).not.toContain('guided_workflow_get');
   const english=workspaceAgentContext('en',{kind:'assetJob',name:'House'});
   expect(english).toContain('human review');
   expect(english).toContain('asset_job_catalog_submit');
   for(const text of [context,english]){
     expect(text).not.toContain('11111111-1111-4111-8111-111111111111');
     expect(text).not.toMatch(/Example JSON:|Пример JSON:/i);
    expect(text).toContain('tool_search');
    expect(text).toContain('mcp__aetherflow asset_job_catalog_submit');
    expect(text).toContain('16');
    expect(text).toContain('AetherFlow asset job catalog submit');
    expect(text).toContain('asset_job_update');
    expect(text).toContain('expectedWorkflowRevision');
    expect(text).toContain('catalogProposal');
   }
   expect(english).toContain('Read the result back');
   expect(english).toContain('do not claim it was submitted');
   for(const locale of ['en','ru'] as const){
    const session=workspaceAgentContext(locale,{kind:'assetJob',id:'job-current',name:'House'});
    expect(session).toMatch(/preserve the style of the original color artwork.*painterly.*brushwork|сохранять стиль именно исходного цветного арта.*живописности.*мазки/i);
     expect(session).toMatch(/select and submit exactly one best structurally usable variant|отправьте в слот ровно один лучший структурно пригодный вариант/i);
    expect(session).toMatch(/do not register, submit, or show intermediate attempts|не регистрируйте, не отправляйте и не показывайте промежуточные попытки/i);
    expect(session).toMatch(/explicit TODO.*every accepted master in catalog order.*saved status|явный TODO.*каждый принятый master в порядке каталога.*сохранёнными статусами/i);
    expect(session).toMatch(/do not stop after one submitted image.*independent color role remains actionable|не останавливайтесь после одного отправленного изображения.*доступная независимая цветная роль/i);
    expect(session).toMatch(/a roof side is generated only if listed in the accepted catalog|side у roof создавайте только если он указан в принятом каталоге/i);
   }
   fs.writeFileSync(installedSkill,'User-maintained Skill content');
   fs.unlinkSync(example); // An existing pre-update workspace has no depth example.

   fs.appendFileSync(result.bootstrap,'\nUser-owned text\n');
   ensureWorkbenchSkills(process.cwd(),root,'en',{kind:'assetJob',id:'example',name:'House'});
   expect(fs.readFileSync(installedSkill,'utf8')).toBe('User-maintained Skill content');
   expect(fs.readFileSync(example)).toEqual(fs.readFileSync(path.resolve('docs/skills/aetherflow-ai-depth-maps/references/depth-style-example.png')));

   const updated=fs.readFileSync(result.bootstrap,'utf8');
   expect(updated).toContain('User-owned text');
   expect(updated).toContain('tool_search');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it('includes discovery and review instructions in prompts for an already-running session in both languages',()=>{
  const context={job:{id:'job',name:'House',data:{mode:'composite',stage:'composition'}},items:[],workflow:{revision:7,data:{slots:[]}}} as any;
  for(const locale of ['en','ru'] as const){
   const prompt=assetProductionPrompt(locale,context);
   expect(prompt).toContain('mcp__aetherflow asset_job_catalog_submit');
   expect(prompt).toContain('tool_search');
   expect(prompt).toContain('AetherFlow asset job catalog submit');
   expect(prompt).toContain('16');
   expect(prompt).toContain('asset_job_update');
   expect(prompt).toContain('expectedWorkflowRevision');
   expect(prompt).toContain('catalogProposal');
   expect(prompt).toContain('workflow revision: 7');
    expect(prompt).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(prompt).not.toMatch(/Example JSON:|Пример JSON:/i);
    expect(()=>AssetCatalogInput.parse({id:'22222222-2222-4222-8222-222222222222',expectedRevision:7,items:[{name:'Wall',route:'module',dimensions:[2,3,0.2],views:['front'],depthEnabled:false}],instances:[{masterItemId:'33333333-3333-4333-8333-333333333333',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]})).not.toThrow();
   for(const field of ['masterItemId','position','rotation','scale','dimensions','views','depthEnabled','shared-prop','foliage'])expect(prompt).toContain(field);
  }
  const english=assetProductionPrompt('en',context);
   expect(english).toMatch(/Composition only prepares a catalog proposal.*does not generate color images/i);
   expect(english).toMatch(/No accepted or pending color outputs are recorded/i);
   expect(english).not.toMatch(/image_gen|generate this image batch now/i);
  expect(english).toContain('Read the result back');
  expect(english).toContain('human review');
  expect(english).toContain('do not edit application data directly');
  const imageContext={job:{id:'job',name:'House',data:{mode:'composite',stage:'images',catalogStatus:'accepted',sourceArtifactId:'source-1'}},items:[],workflow:{revision:7,data:{slots:[]}}} as any;
  for(const locale of ['en','ru'] as const){
   const prompt=assetProductionPrompt(locale,imageContext);
   expect(prompt).toMatch(/preserve the style of the original color artwork.*painterly|сохранять стиль именно исходного цветного арта.*живописности/i);
    expect(prompt).toMatch(/select and submit exactly one best structurally usable variant|отправьте в слот ровно один лучший структурно пригодный вариант/i);
  }
 });
});
