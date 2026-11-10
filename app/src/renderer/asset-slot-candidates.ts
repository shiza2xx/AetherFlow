export type AssetSlotCandidateView<T extends {id:string;status:string}>={primary:T|null;history:T[];pendingReview:T|null};

/** Keep one selected version visible, surface new review work by default, and leave all others in expandable history. */
export function assetSlotCandidateView<T extends {id:string;status:string}>(slot:{candidates?:T[];acceptedCandidateId?:string},selectedCandidateId?:string|null,selectionIsExplicit=false):AssetSlotCandidateView<T>{
 const candidates=Array.isArray(slot.candidates)?slot.candidates:[];
 const selected=selectionIsExplicit?candidates.find(candidate=>candidate.id===selectedCandidateId):null;
 const newestPending=[...candidates].reverse().find(candidate=>candidate.status==='pending');
 const primary=selected
  ||newestPending
  ||candidates.find(candidate=>candidate.id===slot.acceptedCandidateId&&candidate.status==='accepted')
  ||[...candidates].reverse().find(candidate=>candidate.status!=='rejected')
  ||null;
 return {primary,history:candidates.filter(candidate=>candidate!==primary),pendingReview:newestPending&&newestPending.id!==primary?.id?newestPending:null};
}
