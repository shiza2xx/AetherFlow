import {describe,expect,it} from 'vitest';
import {GUIDED_STEPS} from '../main/guided-workflow';
import {journeyGuideContent} from './journeyGuideContent';
import JourneyStepGuide,{getGuideActionCompletion,getGuideActionTarget,nextGuideAction,type GuideSlot,type GuideState} from './JourneyStepGuide';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import JourneySurfaceReport from './JourneySurfaceReport';
import JourneyHeadFitReport from './JourneyHeadFitReport';
import {ReferencePlanContinue,referencePlanContinueMode,type PlanData} from './ReferencePlanEditor';
import CharacterJourney,{type CharacterJourneyProps} from './CharacterJourney';

const state=(slots:GuideSlot[]=[])=>({locale:'ru' as const,stepKey:'receive-materials',currentStepKey:'receive-materials',slots,sourcesCount:1,canContinue:false,blockers:[] as string[]});
const returns=(accepted=0):GuideSlot[]=>['head','hair','upper_body','lower_body','accessories'].map((group,index)=>({slotKey:`texture-return-${group}`,group,artifactId:`return-${index}`,purpose:'model',required:true,reviewStatus:index<accepted?'accepted':'pending'}));

describe('source-stage Astra actions',()=>{
 it('opens the prompt for a checked option with no current plan',()=>{
  expect(referencePlanContinueMode({enabled:true,active:false},false)).toBe('prompt');
  expect(referencePlanContinueMode({enabled:false,active:false},false)).toBe('next');
  expect(referencePlanContinueMode({enabled:true,active:true},false)).toBe('next-with-plan');
  expect(referencePlanContinueMode({enabled:true,active:false},true)).toBe('skip');
 });
 it('keeps Codex and correction actions out of the character source toolbar',()=>{
  const noop=()=>{};
  const props:CharacterJourneyProps={
   locale:'ru',name:'Test character',sources:[],slots:[],blockingReasons:[],canContinue:true,
   sessionLabel:'Codex',currentStepKey:'source',activeStepKey:'source',
   steps:[{key:'source',number:1,title:'Исходник',description:'Референс',owner:'you',state:'current',canOpen:true}],
   onSelectStep:noop,onContinue:noop,onAddSource:noop,onUpload:noop,onGenerate:noop,onReview:noop,
   onPrimary:noop,onOpenCodex:noop,onCopy:noop,onSessionAction:noop,onCorrect:noop,
  };
  const html=renderToStaticMarkup(createElement(CharacterJourney,props));
  expect(html).toContain('journey-continue');
  expect(html).not.toContain('journey-stage-actions');
  expect(html).not.toContain('Корректировка через Codex');
  expect(html).not.toContain('Продолжить в Codex');
  const views=renderToStaticMarkup(createElement(CharacterJourney,{
   ...props,currentStepKey:'views',activeStepKey:'views',
   steps:[{key:'views',number:2,title:'Цветные ракурсы и глубина',description:'Подготовьте согласованные ракурсы для модели.',owner:'codex',state:'current',canOpen:true}],
   slots:['front','left','right','back'].map(view=>({id:view,label:view,slotKey:'reference-head-'+view,part:'head' as const,purpose:'views' as const,view,required:true,canUpload:true})),
  }));
  expect(views.match(/Подготовить генерацию/g)).toHaveLength(1);
  expect(views).toContain('Голова и тело · Цветные ракурсы');
  expect(views).toContain('Открыть Codex');
  expect(views).not.toContain('Корректировка через Codex');

 });

 const plan=(ownerKind:PlanData['ownerKind'],enabled:boolean):PlanData=>({
  ownerKind,ownerId:'test',enabled,ownerRevision:1,markdown:'',lineageHash:'a',sourceHash:'b',
  sourceCount:1,sourceNames:['reference.png'],isCurrent:false,active:false,busy:false,
 });
 for(const ownerKind of ['character','assetJob'] as const)for(const locale of ['ru','en'] as const){
  const render=(data:PlanData,action:'running'|'error'|null=null,disabled=false)=>renderToStaticMarkup(
   createElement(ReferencePlanContinue,{locale,data,action,disabled,onContinue:()=>{}}),
  );
  it(`keeps one Continue action on the normal ${ownerKind} route (${locale})`,()=>{
   for(const enabled of [false,true]){
    const html=render(plan(ownerKind,enabled));
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain(locale==='ru'?'Продолжить':'Continue');
    expect(html).not.toContain('reference-plan-skip');
   }
   expect(render(plan(ownerKind,true),null,true)).toContain('disabled=""');
  });
  it(`shows recovery only following a failed ${ownerKind} analysis (${locale})`,()=>{
   const enabled=plan(ownerKind,true),failed={...enabled,run:{status:'error'}};
   expect(render(enabled,'running')).toContain('disabled=""');
   expect(render(enabled,'running')).not.toContain('reference-plan-skip');
   expect(render(failed)).toContain('reference-plan-skip');
   expect(render(failed)).toContain(locale==='ru'?'Продолжить':'Continue');
   expect(render({...failed,active:true})).not.toContain('reference-plan-skip');
   expect(render({...failed,enabled:false})).not.toContain('reference-plan-skip');
  });
 }
});

describe('stage guidance follows real workflow state',()=>{
 it('covers the actual production route in both app languages, including the depth substep',()=>{
  expect(Object.keys(journeyGuideContent).sort()).toEqual(GUIDED_STEPS.map(([key])=>key).sort());
  for(const [key] of GUIDED_STEPS)for(const locale of ['en','ru'] as const){const copy=journeyGuideContent[key][locale];expect(copy.purpose.length).toBeGreaterThan(20);expect(copy.input.length).toBeGreaterThan(10);expect(copy.actions.length).toBeGreaterThanOrEqual(2);expect(copy.result.length).toBeGreaterThan(20);expect(copy.check.length).toBeGreaterThan(20);}
  expect(journeyGuideContent.views.ru.actions.join(' ')).toContain('2.5');  for(const [key] of GUIDED_STEPS){const copy=journeyGuideContent[key].en,base:GuideState={locale:'en',stepKey:key,currentStepKey:key,slots:[],sourcesCount:0,canContinue:true,blockers:[]},completion=getGuideActionCompletion(base,copy.actions);expect(completion).toHaveLength(key==='receive-materials'?6:copy.actions.length);expect(completion.filter(Boolean).length).toBeLessThanOrEqual(1);expect(copy.actions.map((_,index)=>getGuideActionTarget(key,index))).toHaveLength(copy.actions.length);}
  expect(getGuideActionTarget('receive-mesh',0)).toBe('results');expect(getGuideActionTarget('receive-rig',1)).toBe('operations');expect(getGuideActionTarget('finish',2)).toBe('continue');
 });
 it('tracks source, views and review mini-steps only from their real artifacts and acceptance gates',()=>{
  const source:GuideState={locale:'en',stepKey:'source',currentStepKey:'source',slots:[],sourcesCount:0,canContinue:false,blockers:[]};
  expect(getGuideActionCompletion(source,journeyGuideContent.source.en.actions)).toEqual([false,false]);
  expect(getGuideActionCompletion({...source,sourcesCount:1,canContinue:true},journeyGuideContent.source.en.actions)).toEqual([true,false]);
  const views:GuideState={...source,stepKey:'views',currentStepKey:'views',sourcesCount:1,slots:[...Array.from({length:8},(_,i)=>({purpose:'views' as const,artifactId:`color-${i}`,required:true})),...Array.from({length:3},(_,i)=>({purpose:'depth' as const,artifactId:`depth-${i}`,required:true}))]};
  expect(getGuideActionCompletion(views,journeyGuideContent.views.en.actions)).toEqual([true,false,false]);
  const review:GuideState={...views,stepKey:'review-images',currentStepKey:'review-images',slots:Array.from({length:16},(_,i)=>({purpose:i%2?'depth' as const:'views' as const,artifactId:`img-${i}`,reviewStatus:i<15?'accepted':'pending',required:true}))};
  expect(getGuideActionCompletion(review,journeyGuideContent['review-images'].en.actions)).toEqual([true,false,false]);
  expect(getGuideActionCompletion({...review,slots:review.slots.map(slot=>({...slot,reviewStatus:'accepted'})),canContinue:true},journeyGuideContent['review-images'].en.actions)).toEqual([true,true,true]);
 });
 it('directs pending returns to human review and accepted returns to assembly without inventing a model',()=>{
  const partial=nextGuideAction(state(returns(3)));expect(partial.target).toBe('results');expect(partial.text).toContain('3/5');
  const ready=nextGuideAction(state(returns(5)));expect(ready.target).toBe('operations');expect(ready.text).toContain('Собрать и проверить');
 });
 it('requires assembly review, mapping review and actual completion prerequisites in order',()=>{
  const slots=returns(5).concat({slotKey:'textured-assembly',artifactId:'assembly',purpose:'model',required:true,reviewStatus:'pending'});
  expect(nextGuideAction(state(slots)).text).toContain('осмотрите модель целиком');slots.at(-1)!.reviewStatus='accepted';
  expect(nextGuideAction(state(slots)).text).toContain('Подтверждение соответствия');slots.push({slotKey:'surface-mapping-report',artifactId:'report',purpose:'report',required:true,reviewStatus:'accepted'});
  expect(nextGuideAction(state(slots)).text).toContain('Установить голову на тело');
  slots.push({slotKey:'fitted-assembly',artifactId:'fit',purpose:'model',required:true,reviewStatus:'pending'});
  expect(nextGuideAction(state(slots)).text).toContain('подтвердите положение головы');
  slots.at(-1)!.reviewStatus='accepted';
  expect(nextGuideAction({...state(slots),blockers:['Проверка поверхности не пройдена.']}).text).toBe('Проверка поверхности не пройдена.');
  expect(nextGuideAction({...state(slots),canContinue:true}).target).toBe('continue');
 });
 it('keeps completed stages view-only and does not tell the user to launch an action twice while busy',()=>{
  expect(nextGuideAction({...state(),currentStepKey:'finish',canContinue:true}).target).toBe('route');
  expect(nextGuideAction({...state(returns(5)),busy:true}).text).toContain('Действие выполняется');
 });
 it('uses the actual fit receipt for stale guidance and for completed historical phase markers',()=>{
  const slots=returns(5).concat(['textured-assembly','surface-mapping-report','fitted-assembly'].map(slotKey=>({slotKey,artifactId:slotKey,purpose:'model',required:true,reviewStatus:'accepted'})));
  expect(nextGuideAction({...state(slots),headFit:{current:false,confirmed:false}}).text).toContain('новый предпросмотр');
  const markup=renderToStaticMarkup(createElement(JourneyStepGuide,{...state(slots),currentStepKey:'export-rig-source',headFit:{current:true,confirmed:true}}));
  expect(markup.match(/class="stepper__segment"[^>]*data-status="complete"/g)).toHaveLength(6);expect(markup).toContain('предыдущий этап');expect(markup).toContain('Действия текущего этапа');
 });
 it('uses submitted counts for both color and depth sets and follows the selected language',()=>{
  const slots:GuideSlot[]=[{purpose:'views',artifactId:'color',required:true},{purpose:'depth',artifactId:'depth',required:true}];
  const next=nextGuideAction({...state(slots),locale:'en',stepKey:'views',currentStepKey:'views'});expect(next.text).toContain('Color views: 1/8; depth maps: 1/8');expect(next.target).toBe('generation');
 });
 it('explains a mapping report using its facts while keeping human adoption separate',()=>{
  const markup=renderToStaticMarkup(createElement(JourneySurfaceReport,{locale:'ru',text:JSON.stringify({geometryCorrespondenceProven:true,mappedFaceCount:104140,maxPositionError:.000022,tolerance:.000025,rigWeightsActionsPreserved:true})}));
  expect(markup).toContain('Сопоставление геометрии выполнено');expect(markup).toContain('Сопоставлено граней');expect(markup).toContain('а не ваше подтверждение');expect(markup).toContain('<details>');expect(markup).not.toContain('<details open');
 });
 it('does not invent successful correspondence or rig checks when a report contains no proof',()=>{
  const markup=renderToStaticMarkup(createElement(JourneySurfaceReport,{locale:'en',text:JSON.stringify({status:'failed',mappedFaceCount:0})}));
  expect(markup).toContain('No successful geometry proof');expect(markup).not.toContain('The report confirms complete geometry correspondence.');expect(markup).not.toContain('Existing rig, weight and animation data were preserved.');
 });
 it('keeps saved head-transform preservation separate from human anatomical approval',()=>{
  const text=JSON.stringify({operation:'head-fit',reopenedVerified:true,meshGeometryPreserved:true,materialGraphsPreserved:true,animationFingerprintPreserved:true,bodyTransformsPreserved:true,headGroupTransformVerified:true,anatomicalFitVerified:false,headObjects:['Atelier_head','Atelier_hair'],bodyObjects:['Atelier_upper_body'],translation:[0,0,.5],rotationDegrees:[0,0,0],scale:1});
  const markup=renderToStaticMarkup(createElement(JourneyHeadFitReport,{locale:'ru',text}));
  expect(markup).toContain('Голова, Волосы');expect(markup).toContain('Эти проверки не подтверждают анатомию');expect(markup).toContain('Z 0.500');expect(markup).not.toContain('<details open');
  const failed=renderToStaticMarkup(createElement(JourneyHeadFitReport,{locale:'en',text:'{}'}));expect(failed).toContain('does not contain complete preservation evidence');expect(failed).not.toContain('Mesh, UVs, normals and material assignments preserved.');
 });
});
