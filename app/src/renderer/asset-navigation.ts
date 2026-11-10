import {AssetStageSchema,assetViewsForRoute} from '../shared/asset-production';
export type AssetStage=(typeof AssetStageSchema.options)[number];
export const assetStages=AssetStageSchema.options;
export function nextAssetStage(stage:AssetStage){const index=assetStages.indexOf(stage);return assetStages[Math.min(index+1,assetStages.length-1)];}
export function assetStageHeaderCopy(stage:AssetStage,mode:string,locale:'en'|'ru'='en'){
 const ru=locale==='ru';
 if(stage==='assembly')return mode==='prop-set'
  ?{title:ru?'Экспорт':'Export',description:ru?'Автоматически проверьте принятые файлы и экспортируйте отдельные модели и текстуры. Сцена не нужна.':'Automatically check accepted files and export independent models and textures. No scene is needed.'}
  :{title:ru?'Сборка':'Assembly',description:ru?'Соберите сцену, проверьте и исправьте размещение, примите её и экспортируйте.':'Build, inspect or correct, accept, and export the assembled scene.'};
 const copy:Record<Exclude<AssetStage,'assembly'>,{title:[string,string];description:[string,string]}>= {
  source:{title:['Reference','Референс'],description:['Keep the original reference and object brief together.','Сохраните исходный референс и описание объекта.']},
  composition:{title:['Composition','Состав'],description:['Propose parts, shared props, foliage and repeated instances.','Предложите детали, общие объекты, листву и повторяющиеся экземпляры.']},
  images:{title:['Images','Изображения'],description:['Prepare the required color views for each actual catalog item.','Подготовьте обязательные цветные ракурсы для каждой детали каталога.']},
  geometry:{title:['Geometry','Геометрия'],description:['Import and inspect geometry, shared texture returns and foliage cards.','Импортируйте и проверьте геометрию, текстуры общих объектов и карточки листвы.']},
 };
 return {title:copy[stage].title[ru?1:0],description:copy[stage].description[ru?1:0]};
}
export function defaultAssetImageRole(item:{data:{route:string;views?:string[];viewType?:string}}){return item.data.route==='foliage'?'foliage:front':`image:${assetViewsForRoute(item.data.route,item.data.views,item.data.viewType).find(view=>view==='front'||view==='side')||'front'}`;}

export type AssetNavigationState={job:any;items:any[];workflow:any;current:any[];activeInstances?:any[]};
export type AssetNavigationSelection={itemId:string|null;instanceId:string|null;role:string|null;candidateId:string|null;candidateExplicit:boolean;sceneCandidateId:string|null};

/** Selecting a part in the side rail keeps its stage's real role selected. */
export function resolveAssetItemSelection(stage:string,state:AssetNavigationState,itemId:string):AssetNavigationSelection{
 const item=state.items.find((entry:any)=>entry.id===itemId);if(!item)return {itemId:null,instanceId:null,role:null,candidateId:null,candidateExplicit:false,sceneCandidateId:null};
 const current=state.current.find((entry:any)=>entry.itemId===itemId),savedRole=state.job?.data?.selectedItemId===itemId?state.job.data.selectedRole:null,reviewRoles=['geometry','material','material-reference:front','guide:front','foliage:atlas'],hasRole=(value:string)=>state.workflow?.data?.slots?.some((entry:any)=>entry.itemId===itemId&&entry.role===value),role=stage==='images'?defaultAssetImageRole(item):stage==='geometry'?(reviewRoles.includes(savedRole)&&hasRole(savedRole)?savedRole:'geometry'):stage==='assembly'?(current?.material&&!current.materialNeedsCompatibilityReview?'material':current?.geometry&&!current.geometryNeedsReview?'geometry':null):null;
 if(!role)return {itemId,instanceId:null,role:null,candidateId:null,candidateExplicit:false,sceneCandidateId:null};
 const jobData=state.job?.data||{},preserveExplicit=jobData.selectedCandidateExplicit===true&&jobData.selectedItemId===itemId&&jobData.selectedRole===role,slot=(state.workflow?.data?.slots||[]).find((entry:any)=>entry.itemId===itemId&&entry.role===role),explicit=preserveExplicit?slot?.candidates?.find((entry:any)=>entry.id===jobData.selectedCandidateId):null,pending=[...(slot?.candidates||[])].reverse().find((entry:any)=>entry.status==='pending'),accepted=slot?.candidates?.find((entry:any)=>entry.id===slot?.acceptedCandidateId&&entry.status==='accepted'),candidate=explicit||pending||accepted||null;
 return {itemId,instanceId:null,role,candidateId:candidate?.id||current?.[role]?.id||null,candidateExplicit:!!explicit,sceneCandidateId:null};
}

export function assetSceneCandidateIsCurrent(candidate:any,validation:any,acceptedSceneId?:string|null){
 if(!candidate||!validation?.readyForAssembly||candidate.dependencyFingerprint!==validation.dependencyFingerprint)return false;
 if(candidate.status==='pending')return true;
 return candidate.status==='accepted'&&candidate.id===acceptedSceneId&&validation.scene?.id===candidate.id&&!validation.sceneStale;
}

/** Keep the human review action tied to a current pending scene that was
 * submitted after the accepted scene. Older pending history stays inspectable,
 * but cannot block export after a newer scene was accepted. Without a saved
 * actionable choice, prefer the newest current pending scene (history is append
 * ordered). Rejected and stale entries remain non-actionable.
 */
export function resolvePendingAssetSceneCandidate(candidates:any[],validation:any,acceptedSceneId?:string|null,preferredSceneId?:string|null){
 const history=candidates||[],accepted=history.find((entry:any)=>entry?.id===acceptedSceneId),acceptedIsCurrent=!!accepted&&assetSceneCandidateIsCurrent(accepted,validation,acceptedSceneId),acceptedIndex=acceptedIsCurrent?history.indexOf(accepted):-1;
 const currentPending=history.filter((entry:any,index:number)=>entry?.status==='pending'&&assetSceneCandidateIsCurrent(entry,validation,acceptedSceneId)&&(acceptedIndex<0||index>acceptedIndex));
 const preferred=currentPending.find((entry:any)=>entry.id===preferredSceneId);
 return preferred||currentPending[currentPending.length-1]||null;
}

/** Resolve stage navigation to one persisted, job-owned selection tuple. */
export function resolveAssetNavigationSelection(stage:string,state:AssetNavigationState,preferredItemId?:string|null,preferredSceneId?:string|null,validation?:any):AssetNavigationSelection{
 const {job,items,workflow,current,activeInstances=[]}=state,jobData=job?.data||{},wf=workflow?.data||{},validItem=(id:string|null|undefined)=>items.find((entry:any)=>entry.id===id),catalogCurrent=jobData.catalogStatus==='accepted'&&!jobData.catalogRequiresRevalidation,usableForAssembly=(entry:any)=>{const value=current.find((row:any)=>row.itemId===entry.id);return !!value?.material&&!value.materialNeedsCompatibilityReview||!!value?.geometry&&!value.geometryNeedsReview;},defaultAssemblyItem=stage==='assembly'&&catalogCurrent?(items.find(usableForAssembly)||items[0]):undefined,selectedItem=validItem(preferredItemId)||validItem(jobData.selectedItemId)||((items.length===1&&catalogCurrent)?items[0]:undefined)||defaultAssemblyItem,itemId=selectedItem?.id||null,cur=current.find((entry:any)=>entry.itemId===itemId),slots=wf.slots||[];
 let role:string|null=null,candidateId:string|null=null,candidateExplicit=false,sceneCandidateId:string|null=null;
 const selectRole=(nextRole:string|null,preferredCandidateId?:string|null,preserveExplicit=false)=>{if(!nextRole)return;role=nextRole;const slot=slots.find((entry:any)=>entry.itemId===itemId&&entry.role===nextRole);if(!slot)return;const selected=preserveExplicit?slot.candidates?.find((entry:any)=>entry.id===preferredCandidateId):null,pending=[...(slot.candidates||[])].reverse().find((entry:any)=>entry.status==='pending'),accepted=slot.candidates?.find((entry:any)=>entry.id===slot.acceptedCandidateId&&entry.status==='accepted'),chosen=selected||pending||accepted;candidateId=chosen?.id||null;candidateExplicit=!!selected;};
 if(stage==='images'&&selectedItem){const requested=jobData.selectedRole,available=requiredAssetImageRoles(selectedItem),chosen=available.includes(requested)?requested:available.find((value:string)=>cur?.images?.some((entry:any)=>entry.role===value&&entry.candidate))||available[0],preserveExplicit=jobData.selectedCandidateExplicit===true&&jobData.selectedRole===chosen;selectRole(chosen,jobData.selectedCandidateId,preserveExplicit);}
 else if(stage==='geometry'){const reviewRoles=['geometry','material','material-reference:front','guide:front','foliage:atlas'],requested=jobData.selectedRole,chosen=selectedItem&&reviewRoles.includes(requested)&&slots.some((entry:any)=>entry.itemId===itemId&&entry.role===requested)?requested:'geometry',preserveExplicit=jobData.selectedCandidateExplicit===true&&jobData.selectedRole===chosen;selectRole(chosen,jobData.selectedCandidateId,preserveExplicit);}
 else if(stage==='assembly'&&selectedItem&&jobData.mode==='composite'){
  const preferred=(wf.sceneCandidates||[]).find((entry:any)=>entry.id===preferredSceneId),latestPending=resolvePendingAssetSceneCandidate(wf.sceneCandidates,validation,wf.sceneAcceptedCandidateId,preferredSceneId),accepted=(wf.sceneCandidates||[]).find((entry:any)=>entry.id===wf.sceneAcceptedCandidateId),candidate=preferred&&assetSceneCandidateIsCurrent(preferred,validation,wf.sceneAcceptedCandidateId)?preferred:latestPending||(accepted&&assetSceneCandidateIsCurrent(accepted,validation,wf.sceneAcceptedCandidateId)?accepted:null);
  if(candidate&&assetSceneCandidateIsCurrent(candidate,validation,wf.sceneAcceptedCandidateId))sceneCandidateId=candidate.id;
  else if(cur?.material&&!cur.materialNeedsCompatibilityReview)selectRole('material',jobData.selectedCandidateId,jobData.selectedCandidateExplicit===true&&jobData.selectedRole==='material');
  else if(cur?.geometry&&!cur.geometryNeedsReview)selectRole('geometry',jobData.selectedCandidateId,jobData.selectedCandidateExplicit===true&&jobData.selectedRole==='geometry');
 }
 else if(stage==='assembly'&&selectedItem){
  if(cur?.material&&!cur.materialNeedsCompatibilityReview)selectRole('material',jobData.selectedCandidateId,jobData.selectedCandidateExplicit===true&&jobData.selectedRole==='material');
  else if(cur?.geometry&&!cur.geometryNeedsReview)selectRole('geometry',jobData.selectedCandidateId,jobData.selectedCandidateExplicit===true&&jobData.selectedRole==='geometry');
 }
 const active=activeInstances.find((entry:any)=>entry.id===jobData.selectedInstanceId&&entry.masterItemId===itemId);
 return {itemId,instanceId:stage==='assembly'&&jobData.mode==='composite'?(active?.id||null):null,role,candidateId,candidateExplicit,sceneCandidateId};
}

/** Resolve an instance click through the same persisted item/scene/model tuple as stage navigation. */
export function resolveAssetInstanceSelection(state:AssetNavigationState,instanceId:string,preferredSceneId?:string|null,validation?:any):AssetNavigationSelection{
 const instance=(state.activeInstances||[]).find((entry:any)=>entry.id===instanceId);
 if(!instance)return {itemId:null,instanceId:null,role:null,candidateId:null,candidateExplicit:false,sceneCandidateId:null};
 const job={...state.job,data:{...(state.job?.data||{}),selectedItemId:instance.masterItemId,selectedInstanceId:instance.id}};
 return resolveAssetNavigationSelection('assembly',{...state,job},instance.masterItemId,preferredSceneId,validation);
}

export function requiredAssetImageRoles(item:any):string[]{return item?.data?.route==='foliage'?['foliage:front','foliage:back','foliage:side','foliage:top']:[...assetViewsForRoute(item?.data?.route||'module',item?.data?.views,item?.data?.viewType).filter(view=>view==='front'||view==='side').map((view:string)=>`image:${view}`),...(item?.data?.route==='shared-prop'?['sheet']:[])];}
