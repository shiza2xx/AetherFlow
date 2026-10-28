import {ArrowDown,BookOpen,Check,ChevronDown} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {Locale} from '../shared/i18n';
import {guideCopy} from './journeyGuideContent';
// Supplied React Bits Stepper, scoped to actions within the selected production stage.
// @ts-ignore Vite resolves the local JSX adapter.
import StepperSource,{Step as StepperStep} from './vendor/reactbits/StepperSource.jsx';
import './journeyStepGuide.css';

export type GuideSlot={slotKey?:string;artifactId?:string;reviewStatus?:string;purpose:string;group?:string;required:boolean;delivered?:boolean};
export type GuideEvidence={selectedMesh?:Record<string,string>;groupsValidated?:boolean;textureRepair?:{decision?:string;auditPassed?:boolean};weightCleanup?:{decision?:string;auditPassed?:boolean};finalChecksPassed?:boolean};
export type GuideState={locale:Locale;stepKey:string;currentStepKey:string;slots:GuideSlot[];sourcesCount:number;busy?:boolean;canContinue:boolean;completedStep?:boolean;blockers:string[];headFit?:{current?:boolean;confirmed?:boolean;enabled?:boolean;rigBaselineCurrent?:boolean};evidence?:GuideEvidence};
type Target='agent'|'source'|'generation'|'results'|'operations'|'head-fit'|'head-fit-review'|'continue'|'route';

/** Select instructions from actual domain state; this never advances or approves work. */
export function nextGuideAction(p:GuideState):{text:string;target:Target}{
 const ru=p.locale==='ru',t=(en:string,rus:string)=>ru?rus:en,slot=(key:string)=>p.slots.find(s=>s.slotKey===key),has=(key:string)=>!!slot(key)?.artifactId&&!['invalidated','rejected'].includes(slot(key)?.reviewStatus||'');
 if(p.stepKey!==p.currentStepKey&&p.completedStep&&p.canContinue)return {text:t('This stage is complete. You can inspect its files; Continue returns to your current work.','Этот этап завершён. Можно проверить его файлы; «Продолжить» вернёт к текущей работе.'),target:'continue'};
 if(p.stepKey!==p.currentStepKey)return {text:t('This is an earlier step, open for inspection. Use the stage menu to return to your current work.','Это предыдущий этап, открытый для просмотра. Через меню этапов вернитесь к текущей работе.'),target:'route'};
 if(p.busy)return {text:t('An action is running. Its result must finish checking before you can continue.','Действие выполняется. Дождитесь результата и его проверки, прежде чем продолжать.'),target:'operations'};
 if(p.stepKey==='source')return p.sourcesCount?{text:t('Check the attached artwork, then Continue to prepare views.','Проверьте загруженный арт и нажмите «Продолжить» для подготовки ракурсов.'),target:'continue'}:{text:t('Add your original character artwork. Start with an image, not a model.','Добавьте исходный арт персонажа. Начните с изображения, а не с модели.'),target:'source'};
 const deliveryKeys=p.stepKey==='generate-mesh'?['depth-handoff-head','depth-handoff-body']:p.stepKey==='segment-mesh'?['segmentation-handoff']:p.stepKey==='rig-manual'?['rig-studio-handoff']:p.stepKey==='texture-references'?p.slots.filter(s=>s.slotKey?.startsWith('texture-handoff-')).map(s=>s.slotKey!):[];
 if(deliveryKeys.some(key=>has(key)&&slot(key)?.delivered===false))return {text:t('Prepare the file folder in Stage actions. The saved internal package is available, but its delivered folder is missing or has not been created yet.','Подготовьте папку с файлами в действиях этапа. Внутренний пакет сохранён, но папка для передачи ещё не создана или отсутствует.'),target:'operations'};
 if(p.stepKey==='finish'&&has('verified-export')&&slot('verified-export')?.delivered===false&&p.canContinue)return {text:t('Export the verified model using the result card. Its named files will be delivered to this character’s export folder.','Экспортируйте проверенную модель через карточку результата. Файлы с понятными именами появятся в папке экспорта этого персонажа.'),target:'results'};
 if(p.canContinue)return {text:t('The requirements for this step are satisfied. Review the result, then choose Continue.','Требования этапа выполнены. Просмотрите результат и нажмите «Продолжить».'),target:'continue'};
 if(p.stepKey==='views'){
  const color=p.slots.filter(s=>s.purpose==='views'&&s.artifactId&&!['invalidated','rejected'].includes(s.reviewStatus||'')).length,depth=p.slots.filter(s=>s.purpose==='depth'&&s.artifactId&&!['invalidated','rejected'].includes(s.reviewStatus||'')).length;
  return {text:t(`Color views: ${color}/8; depth maps: ${depth}/8. Prepare the missing views for both head and body using the part and image-set selectors.`,`Цветные ракурсы: ${color}/8; карты глубины: ${depth}/8. Подготовьте недостающие виды головы и тела через переключатели части и набора.`),target:'generation'};
 }
 if(p.stepKey==='review-images')return {text:t(`Images accepted: ${p.slots.filter(s=>s.reviewStatus==='accepted').length}/16. Select and review each color and depth image for both parts.`,`Принято изображений: ${p.slots.filter(s=>s.reviewStatus==='accepted').length}/16. Выберите и проверьте каждый цветной вид и карту глубины обеих частей.`),target:'results'};
 if(p.stepKey==='receive-materials'){
  const returns=p.slots.filter(s=>s.slotKey?.startsWith('texture-return-')),accepted=returns.filter(s=>s.artifactId&&s.reviewStatus==='accepted').length;
  if(!returns.length)return {text:t('No texture groups are available. Check the prepared groups in step 8 before trying to assemble a character.','Текстурные группы не найдены. Проверьте подготовленные группы на этапе 8, прежде чем запускать сборку персонажа.'),target:'route'};
  if(returns.length&&accepted<returns.length)return {text:t(`Texture groups accepted: ${accepted}/${returns.length}. Select each returned group, inspect its model and materials, then accept it.`,`Принято текстурных групп: ${accepted}/${returns.length}. Выберите каждую возвращённую группу, проверьте модель и материалы, затем примите её.`),target:'results'};
  if(!has('textured-assembly'))return {text:t('The group reviews are complete. In Step actions, choose Assemble and validate accepted returns. The empty assembly result is where the checked model will appear.','Проверка групп завершена. В «Действиях этапа» нажмите «Собрать и проверить принятые возвраты». Пока пустой результат сборки предназначен для модели, которая появится после проверки.'),target:'operations'};
  if(slot('textured-assembly')?.reviewStatus!=='accepted')return {text:t('Select Textured assembly, inspect the complete model, then accept it. The separate mapping report still needs review.','Выберите «Текстурированная сборка», осмотрите модель целиком и примите её. Отдельный отчёт соответствия ещё нужно проверить.'),target:'results'};
  if(slot('surface-mapping-report')?.reviewStatus!=='accepted')return {text:t('Select Surface mapping proof. Review the geometry correspondence report and accept the successful result.','Выберите «Подтверждение соответствия поверхности». Проверьте отчёт о соответствии геометрии и примите успешный результат.'),target:'results'};
  if(p.headFit?.enabled===false)return {text:p.blockers[0]||t('Complete the surface correspondence check before fitting the head.','Завершите проверку соответствия поверхности перед подгонкой головы.'),target:'operations'};
  if(!has('fitted-assembly')||p.headFit?.current===false)return {text:t('In Fit head to body, use Codex or adjust the position and scale, then save a new fit preview. Texture assembly does not position the head for you.','В блоке «Установить голову на тело» используйте Codex либо задайте положение и масштаб, затем сохраните новый предпросмотр подгонки. Текстурированная сборка не устанавливает голову за вас.'),target:'head-fit'};
  if(slot('fitted-assembly')?.reviewStatus!=='accepted')return {text:t('Inspect the fitted model from the front, side and back. Check the neck, proportions and hair, then Confirm head placement.','Осмотрите модель после подгонки спереди, сбоку и сзади. Проверьте шею, пропорции и волосы, затем подтвердите положение головы.'),target:'head-fit-review'};
  return {text:p.blockers[0]||t('An independent surface check must pass before Continue becomes available.','Перед продолжением должна пройти независимая проверка поверхности.'),target:'operations'};
 }
 if(p.stepKey==='prepare-groups')return {text:t('Use Organize parts with Codex above the viewer. The agent handles the full inventory; review its group summary before continuing.','Нажмите «Распределить части через Codex» над просмотрщиком. Агент обработает весь инвентарь; перед продолжением проверьте его сводку групп.'),target:p.evidence?.groupsValidated?'continue':'agent'};
 if(p.stepKey==='receive-mesh')return {text:t('Attach the head and body files to their matching results. Each imported model is selected automatically. Inspect and accept both models, then continue.','Добавьте файлы головы и тела в соответствующие результаты. Импортированные модели выбираются автоматически. Проверьте и примите обе модели, затем продолжайте.'),target:'results'};
 if(p.stepKey==='receive-segments')return {text:t('Attach both segmented models to their matching results, inspect the separated parts and accept each successful model.','Добавьте обе сегментированные модели в соответствующие результаты, осмотрите разделённые части и примите каждую удачную модель.'),target:'results'};
 if(p.stepKey==='texture-references')return {text:t('Choose a texture group. Generate and accept its front/back color references. Repeat for every group, then prepare all group folders with one action.','Выберите текстурную группу. Создайте и примите её цветные референсы спереди и сзади. Повторите для каждой группы, затем подготовьте все папки одним действием.'),target:'generation'};
 if(p.stepKey==='receive-rig')return has('rigged-return')?{text:t('Restore the materials in Step actions, then run the independent rig audit and review its results.','Восстановите материалы в «Действиях этапа», затем запустите независимую проверку рига и проверьте результаты.'),target:'operations'}:{text:t('Select Returned rig and add the file exported from Tripo Studio.','Выберите «Возвращённый риг» и добавьте файл, экспортированный из Tripo Studio.'),target:'results'};
 const copy=guideCopy(p.stepKey,p.locale);
 return {text:copy?.actions[0]||p.blockers[0]||t('Inspect the current result before continuing.','Проверьте текущий результат перед продолжением.'),target:'operations'};
}

export function getGuideActionTarget(stepKey:string,index:number,fallback:Target='operations'):Target{
 const map:Record<string,Target[]>={source:['source','continue'],views:['generation','generation','continue'],'review-images':['results','results','continue'],'generate-mesh':['operations','operations','continue'],'receive-mesh':['results','results','continue'],'segment-mesh':['operations','operations','continue'],'receive-segments':['results','results','continue'],'prepare-groups':['agent','results','continue'],'texture-references':['generation','results','operations'],'receive-materials':['results','operations','results','results','head-fit','head-fit-review'],'export-rig-source':['operations','operations'],'rig-manual':['operations','results','continue'],'receive-rig':['results','operations','continue'],'texture-repair':['results','operations','operations'],'weight-cleanup':['results','operations','operations'],finish:['operations','results','continue']};
 return map[stepKey]?.[index]||fallback;
}
/** Completion is tied to a stage's real files, reviews, selections, and validator receipts. */
export function getGuideActionCompletion(p:GuideState,actions:string[]):boolean[]{
 if(p.completedStep)return Array(p.stepKey==='receive-materials'?6:actions.length).fill(true);
 const slot=(key:string)=>p.slots.find(s=>s.slotKey===key),has=(key:string)=>!!slot(key)?.artifactId&&!['invalidated','rejected'].includes(slot(key)?.reviewStatus||''),accepted=(key:string)=>has(key)&&slot(key)?.reviewStatus==='accepted';
 const count=(purpose:string)=>p.slots.filter(s=>s.purpose===purpose&&s.artifactId&&!['invalidated','rejected'].includes(s.reviewStatus||'')).length;
 const color=count('views'),depth=count('depth'),keys=p.slots.map(s=>s.slotKey||''),all=(names:string[])=>names.length>0&&names.every(has),allAccepted=(names:string[])=>names.length>0&&names.every(accepted);
 const delivered=(key:string)=>has(key)&&slot(key)?.delivered!==false,allDelivered=(names:string[])=>names.length>0&&names.every(delivered);
 const actionsFor:Record<string,boolean[]>={
  source:[p.sourcesCount>0,false],views:[color>=8,depth>=8,p.canContinue],
  'review-images':[p.slots.some(s=>s.artifactId),p.slots.length>=16&&p.slots.filter(s=>s.artifactId).length>=16&&p.slots.every(s=>s.reviewStatus==='accepted'),p.canContinue],
  'generate-mesh':[allDelivered(['depth-handoff-head','depth-handoff-body']),false,p.canContinue],
  'receive-mesh':[has('mesh-head')&&has('mesh-body'),!!p.evidence?.selectedMesh?.head&&!!p.evidence?.selectedMesh?.body&&accepted('mesh-head')&&accepted('mesh-body'),p.canContinue],
  'segment-mesh':[delivered('segmentation-handoff'),has('segmented-head')&&has('segmented-body'),p.canContinue],
  'receive-segments':[has('segmented-head')&&has('segmented-body'),accepted('segmented-head')&&accepted('segmented-body'),p.canContinue],
  'prepare-groups':[has('component-inventory'),!!p.evidence?.groupsValidated&&has('groups-manifest')&&has('group-baseline'),all(keys.filter(key=>key.startsWith('texture-guide-')))&&p.canContinue],
  'texture-references':[all(keys.filter(key=>key.startsWith('texture-reference-'))),allAccepted(keys.filter(key=>key.startsWith('texture-reference-'))),allDelivered(keys.filter(key=>key.startsWith('texture-handoff-')))],
  'receive-materials':[allAccepted(keys.filter(key=>key.startsWith('texture-return-'))),has('textured-assembly'),accepted('textured-assembly'),accepted('surface-mapping-report'),has('fitted-assembly')&&p.headFit?.current===true,!!p.headFit?.confirmed],
  'export-rig-source':[p.headFit?.current===true&&p.headFit?.confirmed===true,has('mesh-only-fbx')&&has('geometry-baseline')&&has('surface-baseline')&&p.headFit?.rigBaselineCurrent===true&&p.canContinue],
  'rig-manual':[delivered('rig-studio-handoff'),has('rigged-return'),p.canContinue],
  'receive-rig':[has('rigged-return'),accepted('rigged-model')&&accepted('rig-audit'),p.canContinue],
  'texture-repair':[has('texture-repair-candidate')||p.evidence?.textureRepair?.decision==='no-repair',p.evidence?.textureRepair?.auditPassed===true&&(p.evidence.textureRepair.decision==='no-repair'||accepted('texture-repair-candidate')),p.canContinue],
  'weight-cleanup':[has('weight-cleanup-candidate')||p.evidence?.weightCleanup?.decision==='no-repair',p.evidence?.weightCleanup?.auditPassed===true&&(p.evidence.weightCleanup.decision==='no-repair'||accepted('weight-cleanup-candidate')),p.canContinue],
  finish:[has('verified-export'),has('final-validation-report')&&p.evidence?.finalChecksPassed===true,delivered('verified-export')&&p.canContinue],
 };
 const values=actionsFor[p.stepKey];return Array.from({length:p.stepKey==='receive-materials'?values?.length||0:actions.length},(_,index)=>values?.[index]===true);
}
export default function JourneyStepGuide(p:GuideState&{compactOnly?:boolean;manualOnly?:boolean}){
 const [selectedAction,setSelectedAction]=useState(0),progressSignature=getGuideActionCompletion(p,guideCopy(p.stepKey,p.locale)?.actions||[]).join(',');useEffect(()=>setSelectedAction(0),[p.stepKey,progressSignature]);
 const copy=guideCopy(p.stepKey,p.locale);if(!copy)return null;
 const ru=p.locale==='ru',t=(en:string,rus:string)=>ru?rus:en,next=nextGuideAction(p);
 const jump=(target:Target,element:HTMLElement)=>{
  const root=element.closest('.character-journey');if(!root)return;
  const selector:Record<Target,string>={agent:'.guided-agent-intro',source:'.journey-source-stage',generation:'.journey-stage-actions',results:'.journey-result-rail',operations:'.journey-operations,.guided-delivery-panel','head-fit':'.head-fit-panel','head-fit-review':'.head-fit-review',continue:'.journey-footer',route:'.journey-route-button'};
  const destination=root.querySelector<HTMLElement>(selector[target]);if(!destination)return;
  destination.scrollIntoView({behavior:document.documentElement.dataset.motion==='reduced'?'instant':'smooth',block:'center'});
  if(target==='route')destination.click();else{const control=destination.querySelector<HTMLElement>('button:not(:disabled),summary');control?.focus({preventScroll:true});}
 };
 const targetForAction=(index:number):Target=>getGuideActionTarget(p.stepKey,index,next.target);
 const targetLabel=(target:Target)=>({agent:t('Show Codex action','Показать действие Codex'),source:t('Open artwork controls','Открыть добавление арта'),generation:t('Open generation controls','Открыть генерацию'),results:t('Open results to review','Открыть проверку результатов'),operations:t('Jump to stage actions','Перейти к действиям этапа'),'head-fit':t('Open head fitting','Открыть подгонку головы'),'head-fit-review':t('Open fit review','Открыть проверку подгонки'),continue:t('Go to Continue','Перейти к кнопке «Продолжить»'),route:t('Open stage selector','Открыть список этапов')} as Record<Target,string>)[target];
 const returns=p.slots.filter(s=>s.slotKey?.startsWith('texture-return-')),allReturns=returns.length>0&&returns.every(s=>s.artifactId&&s.reviewStatus==='accepted'),assembly=p.slots.find(s=>s.slotKey==='textured-assembly'),proof=p.slots.find(s=>s.slotKey==='surface-mapping-report');
 const fitted=p.slots.find(s=>s.slotKey==='fitted-assembly');
 const phases=[{name:t('Review groups','Проверить группы'),done:allReturns},{name:t('Assemble','Собрать'),done:!!assembly?.artifactId},{name:t('Review model','Принять модель'),done:assembly?.reviewStatus==='accepted'},{name:t('Review mapping','Проверить соответствие'),done:proof?.reviewStatus==='accepted'},{name:t('Fit head','Установить голову'),done:!!fitted?.artifactId&&p.headFit?.current===true},{name:t('Confirm placement','Подтвердить положение'),done:p.headFit?.confirmed===true}],current=phases.findIndex(s=>!s.done);
 const actionLabels=p.stepKey==='receive-materials'?phases.map(phase=>phase.name):copy.actions;
 const shortTitles:Record<string,string[]>={source:ru?['Добавить арт','Проверить арт']:['Add artwork','Review artwork'],views:ru?['Цветные ракурсы','AI-карты глубины','Отправить на проверку']:['Color views','AI depth maps','Submit for review'],'review-images':ru?['Осмотреть изображения','Принять изображения','Продолжить к сетке']:['Inspect images','Accept images','Continue to mesh']};
 const additionalTitles:Record<string,string[]>={
  'generate-mesh':ru?['Подготовить файлы','Генерация в Tripo','Импорт моделей']:['Prepare files','Generate in Tripo','Continue to import'],
  'receive-mesh':ru?['Добавить модели','Проверить модели','Продолжить']:['Add models','Review models','Continue'],
  'segment-mesh':ru?['Подготовить GLB','Сегментация в Tripo','Перейти к загрузке']:['Prepare GLB','Segment in Tripo','Continue to import'],
  'receive-segments':ru?['Добавить сегменты','Проверить части','Продолжить']:['Add segments','Review parts','Continue'],
  'prepare-groups':ru?['Запустить Codex','Проверить группы','Продолжить']:['Run Codex','Review groups','Continue'],
  'texture-references':ru?['Создать референсы','Принять изображения','Подготовить папки']:['Create references','Review images','Prepare folders'],
  'export-rig-source':ru?['Создать FBX','Проверить основу','Продолжить']:['Create FBX','Check baseline','Continue'],
  'rig-manual':ru?['Подготовить файлы','Создать риг','Вернуть модель']:['Prepare files','Create rig','Return model'],
  'receive-rig':ru?['Добавить риг','Проверить модель','Продолжить']:['Add rig','Validate model','Continue'],
  'texture-repair':ru?['Проверить текстуры','Исправить дефекты','Принять результат']:['Inspect textures','Repair defects','Review result'],
  'weight-cleanup':ru?['Проверить веса','Исправить веса','Принять результат']:['Inspect weights','Repair weights','Review result'],
  finish:ru?['Экспортировать','Проверить файлы','Завершить']:['Export','Verify files','Finish']};
 const actionSteps=actionLabels.map((label,i)=>({label,title:shortTitles[p.stepKey]?.[i]||additionalTitles[p.stepKey]?.[i]||label.split(/[.;]/,1)[0].trim(),done:getGuideActionCompletion(p,actionLabels)[i]??false}));
 const firstPending=actionSteps.findIndex(s=>!s.done),currentAction=firstPending<0?actionSteps.length:firstPending+1,actionState=actionSteps.map((s,i)=>s.done?'complete':i+1===currentAction?'active':'upcoming');
 const focusedAction=Math.min(actionSteps.length,selectedAction||currentAction),focusedTarget=firstPending<0&&!selectedAction?next.target:targetForAction(focusedAction-1);
 return <section className={`journey-step-guide${p.manualOnly?' journey-step-guide-manual-only':''}`} data-testid="journey-step-guide" data-step={p.stepKey} aria-label={t('Step guide','Инструкция этапа')}>
  {!p.manualOnly&&<>
  <div className="journey-action-stepper" data-action-stepper={p.stepKey} aria-label={t('Actions in this stage','Действия текущего этапа')}>
   <StepperSource className="journey-stepper-source journey-action-stepper-source" stepLabel={ru?'Шаг':'Step'} step={focusedAction} initialStep={currentAction} keepLabels onStepChange={setSelectedAction} getStepStatus={(number:number)=>actionState[number-1]||'upcoming'} indicator="numbers" orientation="horizontal" transition="slide" showFooter={false} theme={typeof document!=='undefined'&&document.documentElement.dataset.theme==='light'?'light':'dark'} accentColor="var(--pink)" frame={false} radius={20} width="100%">
    {actionSteps.map((action,i)=><StepperStep key={`${p.stepKey}-${i}`} title={action.title} description={action.done?t('Requirement met','Требование выполнено'):i+1===currentAction?t('Current action','Текущее действие'):t('Still to do','Ещё предстоит')}><div className="journey-action-step-content">{i+1===focusedAction&&<div className="journey-action-cta"><p>{i+1===currentAction?next.text:action.label}</p><button type="button" className="journey-guide-jump" disabled={p.busy} onClick={event=>jump(focusedTarget,event.currentTarget)}><ArrowDown size={15}/><span>{targetLabel(focusedTarget)}</span></button></div>}</div></StepperStep>)}
   </StepperSource>
  </div>
  </>}
  {!p.compactOnly&&<details className="journey-guide-manual" key={p.stepKey}><summary><BookOpen size={15}/><span>{t('Requirements and details','Требования и подробности')}</span><ChevronDown size={14}/></summary><div className="journey-guide-detail"><div><h3>{t('What you need','Что потребуется')}</h3><p>{copy.input}</p><h3>{t('Expected result','Что получится')}</h3><p>{copy.result}</p></div><div><h3>{t('Before continuing','Перед продолжением')}</h3><p>{copy.check}</p></div></div></details>}
 </section>;
}
