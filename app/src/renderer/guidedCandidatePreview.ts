type Candidate={id:string;artifactId?:string;reviewStatus:string;invalidatedReason?:string;technicalValidation?:{status:string;reason?:string}};
type Slot={id:string;artifactId?:string;candidateId?:string;candidates?:Candidate[]};

/** Inspection never changes a slot or adopts historical bytes. */
export function guidedCandidatePreview(slot:Slot|undefined,inspection?:{slotId:string;candidateId:string}|null){
 const candidates=slot?.candidates||[];
 const requested=inspection?.slotId===slot?.id?candidates.find(c=>c.id===inspection?.candidateId&&c.artifactId):undefined;
 const candidate=requested||(!slot?.artifactId?[...candidates].reverse().find(c=>c.artifactId):undefined);
 return {artifactId:candidate?.artifactId||slot?.artifactId,candidate,historyOnly:!!candidate&&candidate.id!==slot?.candidateId};
}
