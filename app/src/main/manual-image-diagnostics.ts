export type ManualImageTimingPhase='managed-import'|'model-conversion'|'asset-validation'|'guided-validation'|'candidate-registration';

const monotonicNow=()=>process.hrtime.bigint();

export function startManualImageTiming(){return monotonicNow();}

/** Emit only fixed phase names and elapsed milliseconds; never include IDs, paths, prompts or image bytes. */
export function finishManualImageTiming(phase:ManualImageTimingPhase,startedAt:bigint){
 const durationMs=Number(monotonicNow()-startedAt)/1_000_000;
 console.info('[AetherFlow diagnostic]',JSON.stringify({scope:'manual-image',phase,durationMs:Number(durationMs.toFixed(1))}));
 return durationMs;
}
