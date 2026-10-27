import {describe,expect,it} from 'vitest';
import {activationAttemptIsUnavailable,soundForActivation} from './sound-events';

function target(options:{event?:string;nav?:boolean;button?:boolean;label?:string;disabled?:boolean}={}){
 const attributes:Record<string,string>={...(options.event?{'data-sound-event':options.event}:{}),...(options.label?{'aria-label':options.label}:{})};
 const element={dataset:{soundEvent:options.event},getAttribute:(name:string)=>attributes[name]||null,textContent:'',closest:(selector:string)=>{
  if(selector==='[data-sound-event]'&&options.event)return element;
  if(selector==='.nav-item,[role="tab"]'&&options.nav)return element;
  if(selector==='button,[role="button"],a'&&options.button)return element;
  if(selector==='button:disabled,[role="button"][aria-disabled="true"],[data-sound-unavailable="true"]'&&options.disabled)return element;
  return null;
 }};
 return element as unknown as Element;
}

describe('semantic studio sound events',()=>{
 it('prioritizes named events, then navigation, then button feedback',()=>{
  expect(soundForActivation(target({event:'drawer',nav:true,button:true}))).toBe('drawer');
  expect(soundForActivation(target({nav:true,button:true}))).toBe('pluck');
  expect(soundForActivation(target({button:true,label:'Delete concept'}))).toBe('drawer');
  expect(soundForActivation(target({button:true}))).toBe('boop');
  expect(soundForActivation(target())).toBeNull();
 });
 it('uses the destination theme and reports unavailable attempts without activation',()=>{
  expect(soundForActivation(target({event:'theme'}),'dark')).toBe('daylight');
  expect(soundForActivation(target({event:'theme'}),'light')).toBe('nightfall');
  expect(activationAttemptIsUnavailable(target({button:true,disabled:true}))).toBe(true);
  expect(activationAttemptIsUnavailable(target({button:true}))).toBe(false);
 });
 it('routes each production and failure signal to its matching supplied sound',()=>{
  for(const name of ['boop','pluck','daylight','nightfall','shake','drawer','summit','orbit','wink'] as const)expect(soundForActivation(target({event:name}))).toBe(name);
 });
});
