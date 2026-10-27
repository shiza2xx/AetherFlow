export function activeGuidedStepAfterRefresh(requested:string,steps:Array<{key:string;canOpen?:boolean}>,currentStepKey:string){
  const selected=steps.find(step=>step.key===requested&&step.canOpen===true);
  return selected?.key||currentStepKey;
}

export function initialGuidedStepApplication(lastAppliedKey:string|null,characterId:string,requestedStepKey:string|undefined,steps:Array<{key:string}>){
  if(!requestedStepKey)return {appliedKey:null,stepKey:null};
  const appliedKey=`${characterId}:${requestedStepKey}`;
  if(lastAppliedKey===appliedKey||!steps.some(step=>step.key===requestedStepKey))return {appliedKey:lastAppliedKey,stepKey:null};
  return {appliedKey,stepKey:requestedStepKey};
}

const RESTORABLE_CANDIDATE_STATES=new Set(['rejected','invalidated','superseded','accepted']);
export function restorableGuidedCandidates<T extends {reviewStatus:string}>(candidates:T[]){
  return candidates.filter(candidate=>RESTORABLE_CANDIDATE_STATES.has(candidate.reviewStatus));
}
