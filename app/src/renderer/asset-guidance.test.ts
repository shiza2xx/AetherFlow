import {describe,expect,it} from 'vitest';
import {assetStageGuidance,assetViewTypeLabel} from './asset-guidance';
import {assetValidationCopy} from './asset-validation-copy';
import {assetGeometryInstructions} from './asset-copy';

const accepted=(role:string)=>({role,candidate:{id:`accepted-${role}`,artifactId:`artifact-${role}`,status:'accepted'}});
const imageItem=(id='chair',views=['front','side'])=>({id,name:id,data:{route:'module',views,depthEnabled:false}});
const context=(overrides:any={})=>({
 stage:'source',busy:false,selectedItemId:'',selectedRole:'',handoff:null,validation:null,exported:null,
 job:{data:{sourceArtifactId:undefined,target:'A wooden chair',catalogStatus:'idle',mode:'composite'}},
 items:[],workflow:{data:{slots:[],catalogProposal:null,sceneAcceptedCandidateId:undefined,sceneCandidates:[],instances:[{id:'placement-default',masterItemId:'chair',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]}},current:[],
 ...overrides,
});

describe('assetStageGuidance',()=>{
 it('localizes displayed module view types while retaining their schema values',()=>{
  const entries=[['wall','Wall','Стена'],['window','Window','Окно'],['roof','Roof','Крыша'],['other','Other','Другое']];
  for(const [value,english,russian] of entries){expect(assetViewTypeLabel(value,'en')).toBe(english);expect(assetViewTypeLabel(value,'ru')).toBe(russian);}
  expect(entries.map(([value])=>value)).toEqual(['wall','window','roof','other']);
 });

 it('localizes the missing bundled image decoder remedy and preserves raw diagnostics',()=>{
  const reason='Bundled FFmpeg image decoder is unavailable. Restore the app bundled tools/ffmpeg/ffmpeg.exe or upload this image as PNG, then retry batch review.',english=assetValidationCopy(reason,'en'),russian=assetValidationCopy(reason,'ru');expect(english.message).toMatch(/bundled image decoder is missing.*upload this image as PNG/i);expect(russian.message).toMatch(/встроенный декодер изображений.*загрузите изображение в PNG/i);expect(english.technicalDetails).toBe(reason);expect(russian.technicalDetails).toBe(reason);
 });
 it('blocks source continuation until both the managed reference and saved brief exist',()=>{
  const empty=assetStageGuidance(context({stage:'source'}));
  expect(empty.canContinue).toBe(false);
  expect(empty.blockers.join(' ')).toMatch(/source image/i);
  expect(empty.actions[0].target).toBe('source-upload');
  const source=assetStageGuidance(context({stage:'source',job:{data:{sourceArtifactId:'source-1',target:'A wooden chair'}}}));
  expect(source.canContinue).toBe(true);
  expect(source.actions.map(action=>action.done)).toEqual([true,true]);
 });

 it('requires human acceptance of the prepared composition proposal',()=>{
  const pending=assetStageGuidance(context({stage:'composition',job:{data:{catalogStatus:'pending'}},workflow:{data:{catalogProposal:{items:[imageItem()]}}}}));
  expect(pending.canContinue).toBe(false);
  expect(pending.actions.map(action=>action.done)).toEqual([true,false]);
  const accepted=assetStageGuidance(context({stage:'composition',job:{data:{catalogStatus:'accepted'}},items:[imageItem()]}));
  expect(accepted.canContinue).toBe(true);
  expect(accepted.actions[1].done).toBe(true);
 });

 it('surfaces empty accepted and pending composite placements before image generation in both locales',()=>{
  const wall=imageItem('wall',['front']),emptyAccepted=context({stage:'composition',job:{data:{mode:'composite',catalogStatus:'accepted'}},items:[wall],workflow:{data:{instances:[],slots:[]}}}),emptyPending=context({stage:'composition',job:{data:{mode:'composite',catalogStatus:'pending'}},items:[wall],workflow:{data:{instances:[],catalogProposal:{items:[wall],instances:[]},slots:[]}}});
  for(const locale of ['en','ru'] as const){
   const accepted=assetStageGuidance(emptyAccepted,locale),pending=assetStageGuidance(emptyPending,locale);
   expect(accepted.canContinue).toBe(false);expect(accepted.blockers.join(' ')).toMatch(locale==='en'?/non-empty placement plan/i:/непуст.*план/i);expect(accepted.actions.find(action=>action.key==='placements')).toMatchObject({done:false,target:'composition-instance-repair'});
   expect(pending.canContinue).toBe(false);expect(pending.blockers.join(' ')).toMatch(locale==='en'?/pending.*proposal.*no placements/i:/ожидающ.*предложен.*нет размещ/i);expect(pending.blockers[0]).toMatch(locale==='en'?/pending.*proposal.*no placements/i:/ожидающ.*предложен.*нет размещ/i);expect(pending.actions.find(action=>action.key==='placements')).toMatchObject({done:false,target:'composition-instance-repair'});
   const imageStage=assetStageGuidance({...emptyAccepted,stage:'images'},locale);expect(imageStage.canContinue).toBe(false);expect(imageStage.actions[0]).toMatchObject({key:'placements',target:'composition-instance-repair',done:false});
  }
  const placed={id:'instance-1',masterItemId:wall.id,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};
  const acceptedPlaced=assetStageGuidance(context({stage:'composition',job:{data:{mode:'composite',catalogStatus:'accepted'}},items:[wall],workflow:{data:{instances:[placed],slots:[]}}}));
  expect(acceptedPlaced.canContinue).toBe(true);expect(acceptedPlaced.actions.some(action=>action.key==='placements')).toBe(false);
  const prop=assetStageGuidance(context({stage:'composition',job:{data:{mode:'prop-set',catalogStatus:'accepted'}},items:[wall],workflow:{data:{instances:[],slots:[]}}}));
  expect(prop.canContinue).toBe(true);expect(prop.actions.some(action=>action.key==='placements')).toBe(false);
 });

 it('shows modular building boundaries in the composition guide without forcing indivisible objects apart',()=>{
  for(const locale of ['en','ru'] as const){
   const guide=assetStageGuidance(context({stage:'composition'}),locale),text=[guide.purpose,guide.userSupplies,guide.codexDoes,guide.review].join(' ');
   expect(text).not.toMatch(/keep a doorway opening|оставьте дверной проём/i);
   if(locale==='en'){
    expect(text).toMatch(/decomposable building.*reusable architectural parts/i);
     expect(text).toMatch(/one continuous solid wall master.*separate window master/i);
     expect(text).toMatch(/same wall master.*including at window locations.*do not propose.*window variant/i);
     expect(text).toMatch(/different wall masters.*material.*texture.*construction/i);
     expect(text).toMatch(/preserve.*accepted windowed.wall.*without automatic.*migration/i);
    expect(text).toMatch(/beam.*trim.*separate/i);
    expect(text).toMatch(/future doorway.*standard wall continuous.*record.*location.*do not create a cutout.*do not imply automatic app cutting.*person manually removes/i);
    expect(text).toMatch(/identical repeated.*one master/i);
    expect(text).toMatch(/naturally indivisible.*do not force/i);
   }else{
    expect(text).toMatch(/разбираем.*здани.*повторно используем.*детал/i);
     expect(text).toMatch(/сплошную стен.*отдельн.*окн/i);
     expect(text).toMatch(/одну стену.*рядом с окнами.*не предлагайте стену с окном/i);
     expect(text).toMatch(/разные masters стен.*материала.*текстуры.*конструкции/i);
     expect(text).toMatch(/сохраняйте.*принятых оконных стен.*без автоматическ.*миграции/i);
    expect(text).toMatch(/балк.*отдел.*геометрии стены/i);
     expect(text).toMatch(/будущ.*дверн.*проём.*запиш.*мест.*пользователь вручн.*удал/i);
    expect(text).toMatch(/не создавай.*вырез.*автоматическ/i);
    expect(text).toMatch(/одинаков.*один master/i);
    expect(text).toMatch(/неделим.*не заставля/i);
   }
  }
 });

 it('keeps manual Tripo modeling and explicit shared-prop segmentation clear',()=>{
  const en=assetGeometryInstructions('en'),ru=assetGeometryInstructions('ru');
  expect(en).toMatch(/ordinary solid module masters.*manually create a separate Tripo model for each accepted geometry master/i);
  expect(en).toMatch(/shared.prop.*color sheet.*separate accepted images.*input.*common 3D model.*segmentation/i);
  expect(en).not.toMatch(/remains a reference, not combined geometry/i);
  expect(en).toMatch(/continuous standard wall.*record.*planned doorway location.*do not create.*cutout.*do not promise or imply.*cut.*automatically/i);
  expect(en).toMatch(/Codex proposes explicit face assignments.*application verifies complete non.overlapping coverage/i);
  expect(en).toMatch(/application does not.*automatically cut.*building/i);
  expect(ru).toMatch(/вручную создайте в Tripo отдельную модель для каждой принятой геометрической детали/i);
  expect(ru).toMatch(/общий цветовой лист shared.prop.*отдельных принятых изображений/i);
  expect(ru).toMatch(/служит входом.*общей 3D.модели/i);
  expect(ru).toMatch(/сегментации и разделения/i);
  expect(ru).not.toMatch(/остаётся референсом, а не общей геометрией/i);
  expect(ru).toMatch(/стен.*сплошн.*зафиксир.*мест.*будущ.*проём.*не создавай.*вырез/i);
  expect(ru).toMatch(/не обещай.*подразумевай.*приложение.*выреж.*автоматическ/i);
  expect(ru).toMatch(/исходник для сегментации и разделения.*явное назначение граней.*приложение проверит/i);
  expect(ru).toMatch(/приложение не.*разрезает.*здан.*автоматическ/i);
 });

 it('uses real required views and review status for image-stage continuation',()=>{
  const chair=imageItem();
  const partial=assetStageGuidance(context({stage:'images',job:{data:{catalogStatus:'accepted',target:'A wooden chair'}},items:[chair],selectedItemId:chair.id,selectedRole:'image:front',current:[{itemId:chair.id,images:[accepted('image:front')]}]}));
  expect(partial.canContinue).toBe(false);
  expect(partial.blockers.join(' ')).toMatch(/side/i);
  const complete=assetStageGuidance(context({stage:'images',job:{data:{catalogStatus:'accepted',target:'A wooden chair'}},items:[chair],selectedItemId:chair.id,selectedRole:'image:front',current:[{itemId:chair.id,images:[accepted('image:front'),accepted('image:side')]}]}));
  expect(complete.canContinue).toBe(true);
  const pending=assetStageGuidance(context({stage:'images',job:{data:{catalogStatus:'accepted',target:'A wooden chair'}},items:[chair],selectedItemId:chair.id,selectedRole:'image:front',workflow:{data:{slots:[{itemId:chair.id,role:'image:front',candidates:[{id:'pending',status:'pending'}]}]}},current:[{itemId:chair.id,images:[accepted('image:front'),accepted('image:side')]}]}));
  expect(pending.canContinue).toBe(false);
 });

 it('blocks completion when a legacy standard catalog still requires an unsupported angle',()=>{
  const legacy=imageItem('legacy-roof',['front','threequarter']),guide=assetStageGuidance(context({stage:'images',job:{data:{catalogStatus:'accepted',target:'A roof tile'}},items:[legacy],current:[{itemId:legacy.id,images:[accepted('image:front'),accepted('image:threequarter')],imagesNeedReview:false}]}));
  expect(guide.canContinue).toBe(false);
  expect(guide.actions[0].done).toBe(false);
  expect(guide.blockers.join(' ')).toMatch(/legacy-roof.*threequarter|unsupported.*threequarter/i);
  expect(guide.blockers.join(' ')).toMatch(/catalog|composition/i);
 });

 it('offers one full-list request without requiring a selected item and preserves a pending proposal beside the accepted list',()=>{
  const seat=imageItem('seat',['front','side']),leaf={id:'foliage',name:'Foliage',data:{route:'foliage',views:['front','back','side','top'],depthEnabled:false}},job={data:{catalogStatus:'pending',catalogPreviouslyAccepted:true,target:'A planted tree'}},workflow={data:{catalogProposal:{items:[imageItem('proposal-only')]},depthEnabled:true,slots:[]}},current=[{itemId:seat.id,images:[]},{itemId:'foliage',images:[]}];
  const guide=assetStageGuidance(context({stage:'images',job,workflow,items:[seat,leaf],current,selectedItemId:'',selectedRole:''}));
  expect(guide.actions.map(action=>action.key)).toEqual(['generate','review']);
  expect(guide.actions[0]).toMatchObject({done:false,target:'images'});
  expect(guide.actions[0].label).toMatch(/generate the entire list/i);
  expect(guide.userSupplies).toMatch(/job-wide depth/i);
  expect(guide.codexDoes).toMatch(/every actual master/i);
  expect(guide.review).toMatch(/color and depth/i);
  expect(guide.blockers.join(' ')).not.toMatch(/select an item/i);
 });

 it('marks list preparation complete from current accepted outputs and advances to review',()=>{
  const chair=imageItem('chair',['front','side']),ready={itemId:chair.id,images:[accepted('image:front'),accepted('image:side')],imagesNeedReview:false,depthsNeedReview:false,sheetsNeedReview:false};const guide=assetStageGuidance(context({stage:'images',job:{data:{catalogStatus:'accepted'}},items:[chair],current:[ready]}));expect(guide.actions[0]).toMatchObject({key:'generate',done:true,target:'images'});expect(guide.actions[1]).toMatchObject({key:'review',done:true,target:'item-rail'});
 });

 it('keeps the first whole-list action visible before outputs and marks review active for pending candidates',()=>{
  const chair=imageItem('chair',['front','side']),job={data:{catalogStatus:'accepted'}},empty=assetStageGuidance(context({stage:'images',job,items:[chair]}));
  expect(empty.actions.map(action=>action.key)).toEqual(['generate','review']);expect(empty.actions[0]).toMatchObject({done:false,target:'images'});expect(empty.actions[0].label).toMatch(/entire list/i);
  const current=[{itemId:chair.id,images:[accepted('image:front'),accepted('image:side')]}],waiting=assetStageGuidance(context({stage:'images',job,items:[chair],current,workflow:{data:{slots:[{itemId:chair.id,role:'image:front',candidates:[{id:'waiting',status:'pending',inputFingerprint:'current'}]}]}}}));
  expect(waiting.actions[0]).toMatchObject({done:true,target:'images'});expect(waiting.actions[1]).toMatchObject({done:false,target:'item-rail'});
 });

 it('requires every selected solid depth view and one mixed-source shared sheet before completing Images',()=>{
  const module={id:'body',name:'Building wall',data:{route:'module',views:['front'],viewType:'wall',depthEnabled:true}},shared={id:'bolt',name:'Shared bolt',data:{route:'shared-prop',views:['front'],depthEnabled:true}},job={data:{catalogStatus:'accepted'}},workflow={data:{depthEnabled:true,slots:[]}};
  const moduleReady={itemId:module.id,images:[accepted('image:front'),accepted('image:side')],depths:[accepted('depth:front')],depthsNeedReview:false,imagesNeedReview:false};
  const missingDepth=assetStageGuidance(context({stage:'images',job,workflow,items:[module],current:[moduleReady]}));expect(missingDepth.canContinue).toBe(false);expect(missingDepth.blockers.join(' ')).toMatch(/depth.*side/i);
  const completeModule=assetStageGuidance(context({stage:'images',job,workflow,items:[module],current:[{...moduleReady,depths:[accepted('depth:front'),accepted('depth:side')]}]}));expect(completeModule.canContinue).toBe(true);
  const color:any=accepted('image:front');color.candidate.hash='color-hash';const depth:any=accepted('depth:front');depth.candidate.dependsOnColorHash='color-hash';
  const sharedReady={itemId:shared.id,images:[color],depths:[depth],sheets:[],imagesNeedReview:false,depthsNeedReview:false,sheetsNeedReview:false};
  const missingSheet=assetStageGuidance(context({stage:'images',job,workflow,items:[shared],current:[sharedReady]}));expect(missingSheet.canContinue).toBe(false);expect(missingSheet.blockers).toEqual([]);expect(missingSheet.actionHint).toBe('Prepare the shared geometry sheet to continue.');
  const pendingSheet=assetStageGuidance(context({stage:'images',job,workflow,items:[shared],current:[{...sharedReady,sheetCandidates:[{candidateId:'pending-sheet',status:'pending',fresh:true}]}]}));expect(pendingSheet.canContinue).toBe(false);expect(pendingSheet.blockers).toEqual([]);expect(pendingSheet.actionHint).toMatch(/review.*sheet/i);
  const pendingColor=assetStageGuidance(context({stage:'images',job,workflow:{data:{slots:[{itemId:shared.id,role:'image:front',candidates:[{id:'pending-color',status:'pending',inputFingerprint:'current'}]}]}},items:[shared],current:[sharedReady]}));expect(pendingColor.blockers.join(' ')).toMatch(/review the pending image candidate/i);expect(pendingColor.blockers.join(' ')).not.toMatch(/add and accept the missing/i);
  expect(assetStageGuidance(context({stage:'images',job,workflow,items:[shared],current:[sharedReady]}),'ru').actionHint).toBe('Подготовьте общий лист геометрии, чтобы продолжить.');
  expect(missingSheet.actions.map(action=>action.done)).toEqual([true,true,false]);expect(missingSheet.actions[2].target).toBe('shared-sheet');
  const completeShared=assetStageGuidance(context({stage:'images',job,workflow,items:[shared],current:[{...sharedReady,sheets:[{hash:'sheet',fresh:true,candidate:accepted('sheet').candidate}]}]}));expect(completeShared.canContinue).toBe(true);
 });

 it('keeps image requests behind accepted catalog review and routes the guide back to composition',()=>{
  const empty=assetStageGuidance(context({stage:'images'}));
  expect(empty.canContinue).toBe(false);
  expect(empty.blockers.join(' ')).toMatch(/catalog/i);
  expect(empty.actions[0].target).toBe('composition');
 });

 it('keeps geometry freshness blocking while allowing an unrequested material return',()=>{
  const chair=imageItem(),ready={itemId:chair.id,images:[accepted('image:front'),accepted('image:side')],geometry:{id:'mesh'},geometryNeedsReview:false,material:null};
  const job={data:{catalogStatus:'accepted',target:'A wooden chair'}};
  expect(assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[{...ready,geometry:null}]})).canContinue).toBe(false);
  const geometryWithoutImages=assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[{...ready,images:[accepted('image:front')]}]}));
  expect(geometryWithoutImages.actions[0].target).toBe('images');
  expect(assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[ready]})).canContinue).toBe(true);
  expect(assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[ready]})).actions.find(action=>action.key==='reviews')).toMatchObject({optional:true,skipped:true,done:true});
  expect(assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[ready]})).canContinue).toBe(true);
  expect(assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[{...ready,geometry:null}]})).actions[1].target).toBe('geometry-import');
  expect(assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[{...ready,material:{id:'mat'},materialNeedsCompatibilityReview:true}]})).canContinue).toBe(false);
 });

 it('directs foliage cards through the local checked operation instead of Tripo geometry',()=>{
  const leaves={id:'leaves',name:'Canopy cards',data:{route:'foliage',views:['front','back','side','top'],depthEnabled:false}},guide=assetStageGuidance(context({stage:'geometry',job:{data:{catalogStatus:'accepted'}},items:[leaves],current:[{itemId:leaves.id,images:[accepted('foliage:front')],geometry:null}]}));
  expect(guide.userSupplies).toMatch(/Foliage cards are built locally from four accepted views/i);expect(guide.codexDoes).toMatch(/mode foliage/i);expect(guide.blockers.join(' ')).toMatch(/do not send foliage to Tripo/i);
 });

 it('keeps pending or stale material submissions out of Continue readiness',()=>{
  const chair=imageItem(),ready={itemId:chair.id,images:[accepted('image:front'),accepted('image:side')],geometry:{id:'mesh',hash:'geometry-current'},geometryInputFingerprint:'geometry-input',materialInputFingerprint:'material-input',geometryNeedsReview:false,material:null},job={data:{catalogStatus:'accepted',target:'A wooden chair'}};
  const candidate={id:'pending-material',status:'pending',dependsOnGeometryHash:'geometry-current',inputFingerprint:'material-input'},pendingSlot={itemId:chair.id,role:'material',candidates:[candidate]};
  const waiting=assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[ready],workflow:{data:{slots:[pendingSlot]}}}));
  expect(waiting.canContinue).toBe(false);
  expect(waiting.blockers.join(' ')).toMatch(/pending material candidate/i);
  expect(waiting.actions.find(action=>action.key==='reviews')?.done).toBe(false);
  expect(waiting.actions.find(action=>action.key==='reviews')?.target).toBe('material-import');
  const selectedWaiting=assetStageGuidance(context({stage:'geometry',job,items:[chair],selectedItemId:chair.id,current:[ready],workflow:{data:{slots:[pendingSlot]}}}));
  expect(selectedWaiting.actions.find(action=>action.key==='reviews')?.target).toBe('material-review');
  const stale=assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[ready],workflow:{data:{slots:[{...pendingSlot,candidates:[{...candidate,dependsOnGeometryHash:'geometry-old'}]}]}}}));
  expect(stale.canContinue).toBe(false);
  expect(stale.blockers.join(' ')).toMatch(/submitted material is stale/i);
  expect(stale.actions.find(action=>action.key==='reviews')?.target).toBe('material-import');
 });

 it('reports optional projection-guide state without pretending it was created',()=>{
  const chair=imageItem(),ready={itemId:chair.id,images:[accepted('image:front'),accepted('image:side')],geometry:{id:'mesh'},geometryNeedsReview:false},job={data:{catalogStatus:'accepted',target:'A wooden chair'}};
  const unused=assetStageGuidance(context({stage:'geometry',job,items:[chair],current:[ready]})).actions.find(action=>action.key==='reviews');
  expect(unused).toMatchObject({done:true,optional:true,skipped:true});
  const pending=assetStageGuidance(context({stage:'geometry',job,items:[chair],selectedItemId:chair.id,current:[ready],workflow:{data:{slots:[{itemId:chair.id,role:'guide:front',candidates:[{id:'guide-pending',status:'pending'}]}]}}})).actions.find(action=>action.key==='reviews');
  expect(pending).toMatchObject({done:false,optional:true,skipped:false,target:'materials-guide-review'});
  const completed=assetStageGuidance(context({stage:'geometry',job,items:[chair],selectedItemId:chair.id,current:[ready],workflow:{data:{slots:[{itemId:chair.id,role:'guide:front',acceptedCandidateId:'guide-accepted',candidates:[{id:'guide-accepted',status:'accepted'}]}]}}})).actions.find(action=>action.key==='reviews');
  expect(completed).toMatchObject({done:true,optional:true,skipped:true});
 });

 it('blocks a saved material color reference whose accepted input fingerprint is stale',()=>{
  const chair=imageItem(),ready={itemId:chair.id,images:[accepted('image:front'),accepted('image:side')],geometry:{id:'mesh'},geometryNeedsReview:false,materialInputFingerprint:'current-material-input'},workflow={data:{slots:[{itemId:chair.id,role:'material-reference:front',acceptedCandidateId:'reference',candidates:[{id:'reference',status:'accepted',inputFingerprint:'old-material-input'}]}]}},guide=assetStageGuidance(context({stage:'geometry',job:{data:{catalogStatus:'accepted',target:'A wooden chair'}},items:[chair],current:[ready],workflow}));
  expect(guide.canContinue).toBe(false);
  expect(guide.blockers.join(' ')).toMatch(/material color reference is stale/i);
  expect(guide.actions.find(action=>action.key==='reviews')).toMatchObject({done:false,skipped:false,target:'material-review'});
 });

 it('finishes assembly only after validation and current scene export',()=>{
  const stage=context({stage:'assembly',validation:{readyForAssembly:false,readyForExport:false,issues:['chair geometry is stale']}});
  expect(assetStageGuidance(stage).actions[0].done).toBe(false);
  expect(assetStageGuidance(stage).blockers.join(' ')).toContain('chair geometry is stale');
  const ready=assetStageGuidance(context({stage:'assembly',validation:{readyForAssembly:true,readyForExport:true,scene:{id:'scene-1'},sceneStale:false,dependencyFingerprint:'current',issues:[]},workflow:{data:{sceneAcceptedCandidateId:'scene-1',sceneCandidates:[{id:'scene-1',status:'accepted'}],slots:[]}},exported:{operationId:'export-1'}}));
  expect(ready.actions.map(action=>action.done)).toEqual([true,true,true]);
 });

 it('presents prop sets as automatic check then export, while retaining a scene step only for composites',()=>{
  const legacyScene={id:'legacy-scene',status:'accepted',dependencyFingerprint:'legacy'},prop=context({stage:'assembly',job:{data:{mode:'prop-set',catalogStatus:'accepted',selectedSceneCandidateId:legacyScene.id}},validation:{readyForAssembly:true,readyForExport:true,issues:[],dependencyFingerprint:'current',scene:null,sceneStale:false},workflow:{data:{sceneAcceptedCandidateId:legacyScene.id,sceneCandidates:[legacyScene],slots:[],instances:[]}}});
  const propGuide=assetStageGuidance(prop);
  expect(propGuide.actions.map(action=>action.key)).toEqual(['validate','export']);
  expect(propGuide.actions[0]).toMatchObject({done:true,label:'Automatic file and dependency check'});
  expect(propGuide.actions[1]).toMatchObject({done:false,target:'assembly-export',label:'Export independent models and textures'});
  expect(propGuide.actions.map(action=>action.label).join(' ')).not.toMatch(/scene/i);
  expect(prop.workflow.data.sceneCandidates).toEqual([legacyScene]);
  expect(assetStageGuidance(prop,'ru').actions.map(action=>action.key)).toEqual(['validate','export']);
  expect(assetStageGuidance(prop,'ru').actions.map(action=>action.label).join(' ')).not.toMatch(/сцен/i);
  const composite=context({stage:'assembly',job:{data:{mode:'composite',catalogStatus:'accepted'}},validation:{readyForAssembly:true,readyForExport:true,scene:{id:'scene-1'},sceneStale:false,dependencyFingerprint:'current',issues:[]},workflow:{data:{sceneAcceptedCandidateId:'scene-1',sceneCandidates:[{id:'scene-1',status:'accepted'}],slots:[],instances:[]}}});
  expect(assetStageGuidance(composite).actions.map(action=>action.key)).toEqual(['validate','scene','export']);
  expect(assetStageGuidance(composite,'ru').actions.map(action=>action.key)).toEqual(['validate','scene','export']);
  const stale=context({stage:'assembly',job:{data:{mode:'composite',catalogStatus:'accepted'}},validation:{readyForAssembly:true,readyForExport:false,sceneStale:true,scene:null,issues:[],dependencyFingerprint:'current'},workflow:{data:{sceneAcceptedCandidateId:'scene-old',sceneCandidates:[{id:'scene-old',status:'accepted'}],slots:[],instances:[]}}});
  expect(assetStageGuidance(stale).blockers.join(' ')).toMatch(/accepted scene no longer matches current parts/i);
  expect(assetStageGuidance(stale).actions[1].target).toBe('assembly-build');
  expect(assetStageGuidance(stale).actions[2].target).toBe('assembly-build');
 });

 it('points validation blockers to real repair controls rather than disabled scene and export actions',()=>{
  const missingInstance=context({stage:'assembly',job:{data:{mode:'composite'}},validation:{readyForAssembly:false,readyForExport:false,issues:['Composite has no active instances.']},workflow:{data:{sceneAcceptedCandidateId:'scene-old',sceneCandidates:[{id:'scene-old',status:'accepted'}],slots:[],instances:[]}}});
  expect(assetStageGuidance(missingInstance).actions[0].done).toBe(false);
  expect(assetStageGuidance(missingInstance).actions[1].target).toBe('assembly-instance-repair');
  expect(assetStageGuidance(missingInstance).actions[2].target).toBe('assembly-instance-repair');
  expect(assetStageGuidance(missingInstance).codexDoes).toMatch(/accepted models.*placement proposal|принятые модели.*предложение размещений/i);
 });

 it('keeps validation and scene/export jump targets on the current actionable blocker',()=>{
  const catalog=context({stage:'assembly',job:{data:{mode:'composite',catalogStatus:'pending',catalogRequiresRevalidation:true}},validation:{readyForAssembly:false,readyForExport:false,issues:['Catalog requires human acceptance.']},workflow:{data:{sceneAcceptedCandidateId:'scene-old',sceneCandidates:[{id:'scene-old',status:'accepted'}],slots:[],instances:[]}}});
  const guide=assetStageGuidance(catalog);
  expect(guide.actions[0]).toMatchObject({done:false,target:'composition'});
  expect(guide.actions[1]).toMatchObject({done:false,target:'composition'});
  expect(guide.actions[2].target).toBe('composition');
  const staleGeometry=context({stage:'assembly',job:{data:{mode:'composite'}},validation:{readyForAssembly:false,readyForExport:false,issues:['Planter: current geometry is missing or stale.']},workflow:{data:{sceneAcceptedCandidateId:'scene-old',sceneCandidates:[{id:'scene-old',status:'accepted'}],slots:[],instances:[]}}});
  expect(assetStageGuidance(staleGeometry).actions[0].done).toBe(false);
  expect(assetStageGuidance(staleGeometry).actions[1].target).toBe('geometry-import');
 });
 it('routes an accepted current scene with unconfirmed export readiness back to Validate',()=>{
  const scene={id:'scene-current',status:'accepted',dependencyFingerprint:'current'},guide=assetStageGuidance(context({stage:'assembly',job:{data:{mode:'composite',catalogStatus:'accepted'}},validation:{readyForAssembly:true,readyForExport:false,scene,sceneStale:false,dependencyFingerprint:'current',issues:[]},workflow:{data:{sceneAcceptedCandidateId:scene.id,sceneCandidates:[scene],slots:[],instances:[]}}}));
  expect(guide.actions[1]).toMatchObject({done:true,target:'assembly'});
  expect(guide.actions[2]).toMatchObject({done:false,target:'assembly',label:'Wait for the automatic export check'});
 });
 it('routes a current pending scene to review before rebuilding',()=>{
  const candidate={id:'scene-pending',status:'pending',dependencyFingerprint:'current'},guide=assetStageGuidance(context({stage:'assembly',job:{data:{mode:'composite'}},validation:{readyForAssembly:true,readyForExport:false,dependencyFingerprint:'current',issues:[]},workflow:{data:{sceneAcceptedCandidateId:null,sceneCandidates:[candidate],slots:[],instances:[]}}}));
  expect(guide.blockers.join(' ')).toMatch(/review or reject the current scene candidate/i);
  expect(guide.actions[1]).toMatchObject({target:'assembly-scene',done:false});
  expect(guide.actions[2].target).toBe('assembly-scene');
 });
});

describe('asset validation copy',()=>{
 it('localizes missing and stale geometry issues while preserving item names and raw detail',()=>{
  for(const item of ['Stone planter module','Oak beam']){
   const raw=`${item}: current geometry is missing or stale.`,copy=assetValidationCopy(raw,'ru');
   expect(copy.message).toContain(item);
   expect(copy.message).toMatch(/актуальн.*геометри.*отсутствует|отсутствует актуальн.*геометри/i);
   expect(copy.technicalDetails).toBe(raw);
  }
 });

 it('localizes image, material and stale-scene blockers without translating item names',()=>{
  const image='Stone planter module: image inputs require review.',material='Stone planter module: material needs compatibility review.',scene='The accepted scene no longer matches current parts. Rebuild and review the scene before export.';
  expect(assetValidationCopy(image,'ru').message).toBe('Изображения детали «Stone planter module» требуют проверки.');
  expect(assetValidationCopy(material,'ru').message).toBe('Для детали «Stone planter module» нужно проверить совместимость материала с геометрией.');
  expect(assetValidationCopy(scene,'ru').message).toContain('Принятая сцена больше не соответствует актуальным деталям.');
  expect(assetValidationCopy(scene,'ru').technicalDetails).toBe(scene);
 });

 it('localizes returned-material warnings and keeps unknown backend diagnostics visible verbatim',()=>{
  const warning='Stone planter module: returned model materials need visual verification.',unknown='Blender returned exit code 17 for dependency work/model.obj.';
  expect(assetValidationCopy(warning,'ru')).toMatchObject({message:'Проверьте внешний вид материалов в возвращённой модели детали «Stone planter module».',technicalDetails:warning});
  expect(assetValidationCopy('UV maps are missing on Mesh and Canopy.','ru')).toMatchObject({message:'В возвращённой модели отсутствуют UV-развёртки: Mesh and Canopy.',technicalDetails:'UV maps are missing on Mesh and Canopy.'});
  expect(assetValidationCopy('Materials are missing on Mesh.','ru').message).toBe('В возвращённой модели не назначены материалы: Mesh.');
  expect(assetValidationCopy('Texture files are missing: textures/albedo.png.','ru').message).toBe('Не найдены файлы текстур: textures/albedo.png.');
  expect(assetValidationCopy(unknown,'ru')).toEqual({message:unknown});
 });
});
