import type {StudioSound} from './sound-events';
import boopUrl from '../assets/sounds/boop.wav?url';
import pluckUrl from '../assets/sounds/pluck.wav?url';
import daylightUrl from '../assets/sounds/daylight.wav?url';
import nightfallUrl from '../assets/sounds/nightfall.wav?url';
import shakeUrl from '../assets/sounds/shake.wav?url';
import drawerUrl from '../assets/sounds/drawer.wav?url';
import summitUrl from '../assets/sounds/summit.wav?url';
import orbitUrl from '../assets/sounds/orbit.wav?url';
import winkUrl from '../assets/sounds/wink.wav?url';

const sources:Record<StudioSound,string>={boop:boopUrl,pluck:pluckUrl,daylight:daylightUrl,nightfall:nightfallUrl,shake:shakeUrl,drawer:drawerUrl,summit:summitUrl,orbit:orbitUrl,wink:winkUrl};
const VOICE_LIMIT=6;
let enabled=true,volume=.28,context:AudioContext|undefined,bus:GainNode|undefined;
const buffers=new Map<StudioSound,Promise<AudioBuffer>>();
const voices:AudioBufferSourceNode[]=[];
let gestureUnlocked=false;
const isVisible=()=>document.visibilityState!=='hidden';

function output():AudioContext|undefined {
 if(typeof window==='undefined'||!('AudioContext'in window))return;
 if(!context){context=new AudioContext({latencyHint:'interactive'});bus=context.createGain();bus.gain.value=volume;bus.connect(context.destination);}
 return context;
}
function bufferFor(ctx:AudioContext,name:StudioSound):Promise<AudioBuffer>{
 let pending=buffers.get(name);if(!pending){pending=fetch(sources[name]).then(response=>{if(!response.ok)throw new Error(`Sound asset unavailable: ${name}`);return response.arrayBuffer()}).then(bytes=>ctx.decodeAudioData(bytes));buffers.set(name,pending);pending.catch(()=>buffers.delete(name));}return pending;
}
export function configureSounds(options:{enabled:boolean;volume:number}):void {
 enabled=options.enabled;volume=Math.max(0,Math.min(1,Number.isFinite(options.volume)?options.volume:.28));if(bus)bus.gain.setTargetAtTime(enabled?volume:0,context!.currentTime,.012);
}
export async function playStudioSound(name:StudioSound):Promise<boolean>{
 if(!enabled||volume===0||!isVisible())return false;
 const ctx=output();if(!ctx)return false;
 if(!gestureUnlocked){gestureUnlocked=true;void ctx.resume().catch(()=>{gestureUnlocked=false;});}
 try{if(ctx.state==='suspended')await ctx.resume();const buffer=await bufferFor(ctx,name);if(!enabled||!isVisible())return false;if(voices.length>=VOICE_LIMIT){voices.shift()?.stop();}const voice=ctx.createBufferSource();voice.buffer=buffer;voice.connect(bus!);voices.push(voice);voice.onended=()=>{const i=voices.indexOf(voice);if(i>=0)voices.splice(i,1);voice.disconnect();};voice.start();return true;}catch{return false;}
}

// Native desktop browsers suspend output when hidden. Keep one bounded shared graph.
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(context){if(document.visibilityState==='hidden')void context.suspend().catch(()=>{});else if(enabled&&gestureUnlocked)void context.resume().catch(()=>{});}});
