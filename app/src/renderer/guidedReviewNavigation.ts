export function nextPendingReviewSlotId(slots:unknown,currentSlotId:string):string|null{
 if(!Array.isArray(slots)||!slots.length)return null;
 const rows=slots as Array<{id?:unknown;artifactId?:unknown;reviewStatus?:unknown}>;
 const current=rows.findIndex(slot=>slot.id===currentSlotId);if(current<0)return null;
 for(let offset=1;offset<rows.length;offset++){const slot=rows[(current+offset)%rows.length];if(typeof slot.id==='string'&&slot.artifactId&&slot.reviewStatus==='pending')return slot.id;}
 return null;
}
