import {describe,expect,it} from 'vitest';
import {GUIDED_STEPS} from '../main/guided-workflow';
import {journeyGuideContent} from './journeyGuideContent';
import JourneyStepGuide,{getGuideActionCompletion,getGuideActionTarget,nextGuideAction,type GuideSlot,type GuideState} from './JourneyStepGuide';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import JourneySurfaceReport from './JourneySurfaceReport';
import JourneyHeadFitReport from './JourneyHeadFitReport';

const state=(slots:GuideSlot[]=[])=>({locale:'ru' as const,stepKey:'receive-materials',currentStepKey:'receive-materials',slots,sourcesCount:1,canContinue:false,blockers:[] as string[]});
const returns=(accepted=0):GuideSlot[]=>['head','hair','upper_body','lower_body','accessories'].map((group,index)=>({slotKey:`texture-return-${group}`,group,artifactId:`return-${index}`,purpose:'model',required:true,reviewStatus:index<accepted?'accepted':'pending'}));

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
