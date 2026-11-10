import {assetViewsForRoute} from './asset-production';

export type SharedSheetSourceType='color'|'depth';
export type SharedSheetSource={
 itemId:string;
 itemName:string;
 /** Canonical view role, including for persisted legacy input aliases. */
 role:string;
 /** Persisted slot role when a legacy alias supplied the canonical front view. */
 sourceSlotRole?:string;
 sourceType:SharedSheetSourceType;
 sourceArtifactId?:string;
 sourceHash?:string;
 sourceInputFingerprint?:string;
 pairedColorHash?:string;
 state:'ready'|'missing'|'pending'|'stale';
};
export type SharedSheetDependency={itemId:string;itemName:string;role:string;state:'missing'|'pending'|'stale'};
export type SharedSheetPlan={
 ownerItemId:string|null;
 items:Array<{itemId:string;role:string}>;
 sources:SharedSheetSource[];
 dependencies:SharedSheetDependency[];
 inputSnapshot:Array<Omit<SharedSheetSource,'itemName'|'state'>>;
 pendingCandidateId:string|null;
 pendingItemId:string|null;
 pendingStale:boolean;
 acceptedCurrent:boolean;
 acceptedStale:boolean;
 ready:boolean;
};

const selectedCandidate=(slot:any)=>slot?.candidates?.find((value:any)=>value.id===slot.acceptedCandidateId&&value.status==='accepted'&&value.reviewedBy==='human')||null;

/** Resolve one exact geometry input per shared prop: accepted depth front when enabled, color front otherwise. */
export function sharedPropSheetReadiness(items:any[],workflow:any,current:any[]):SharedSheetPlan{
 const order=new Map<string,number>((workflow?.data?.catalogItemOrder||[]).map((id:string,index:number)=>[id,index]));
 const props=items.filter(item=>item?.data?.route==='shared-prop').sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER)||String(a.name).localeCompare(String(b.name))||a.id.localeCompare(b.id));
 const slots:any[]=workflow?.data?.slots||[],states=new Map<string,any>(current.map(value=>[value.itemId,value]));
 const sharedIds=new Set(props.map(item=>item.id)),sheetSlots=slots.filter(slot=>sharedIds.has(slot.itemId)&&slot.role==='sheet');
 const ownerItemId=sheetSlots[0]?.itemId||props[0]?.id||null;
 const dependencies:SharedSheetDependency[]=[],sources:SharedSheetSource[]=[],inputSnapshot:Array<Omit<SharedSheetSource,'itemName'|'state'>>=[];
 const acceptedSource=(item:any,kind:'image'|'depth')=>{
  const role=kind==='depth'?'depth:front':'image:front',legacyRole=kind==='depth'?'depth':'image',state=states.get(item.id),fingerprints=Array.isArray(state?.imageInputFingerprints)?state.imageInputFingerprints:[];
  const sourceSlots=[slots.find(slot=>slot.itemId===item.id&&slot.role===role),slots.find(slot=>slot.itemId===item.id&&slot.role===legacyRole)].filter((slot:any,index:number,array:any[])=>slot&&array.indexOf(slot)===index);
  const candidates=sourceSlots.map((slot:any)=>{const candidate=selectedCandidate(slot),current=!!candidate?.inputFingerprint&&fingerprints.includes(candidate.inputFingerprint),pending=(slot?.candidates||[]).some((value:any)=>value.status==='pending'&&!!value.inputFingerprint&&fingerprints.includes(value.inputFingerprint));return {slot,candidate,current,pending};});
  const selected=candidates.find(value=>value.candidate&&value.current)||candidates.find(value=>value.candidate)||candidates.find(value=>value.pending);
  if(!selected)return {role,slot:undefined,slotRole:undefined,candidate:null,pending:false,current:false};
  return {role,slot:selected.slot,slotRole:selected.slot.role,candidate:selected.candidate,pending:!selected.current&&selected.pending,current:selected.current};
 };
 for(const item of props){
  const useDepth=item.data.depthEnabled===true,color=acceptedSource(item,'image'),chosen=useDepth?acceptedSource(item,'depth'):color;
  let state:'ready'|'missing'|'pending'|'stale'='ready',pairedColorHash:string|undefined;
  if(useDepth){
   if(color.candidate)pairedColorHash=color.candidate.hash;
   if(!color.candidate)state=color.pending?'pending':'missing';
   else if(!color.current)state=color.pending?'pending':'stale';
   else if(!chosen.candidate)state=chosen.pending?'pending':'missing';
   else if(!chosen.current||chosen.candidate.dependsOnColorHash!==color.candidate.hash)state=chosen.pending?'pending':'stale';
  }else if(!chosen.candidate)state=chosen.pending?'pending':'missing';
  else if(!chosen.current)state=chosen.pending?'pending':'stale';
  const source:SharedSheetSource={itemId:item.id,itemName:String(item.name||item.id),role:chosen.role,...chosen.slotRole&&chosen.slotRole!==chosen.role?{sourceSlotRole:chosen.slotRole}:{},sourceType:useDepth?'depth':'color',state,...chosen.candidate?{sourceArtifactId:chosen.candidate.artifactId,sourceHash:chosen.candidate.hash,sourceInputFingerprint:chosen.candidate.inputFingerprint}: {},...pairedColorHash?{pairedColorHash}:{}};
  sources.push(source);
  if(state!=='ready')dependencies.push({itemId:item.id,itemName:source.itemName,role:source.role,state});
  else{
   inputSnapshot.push({itemId:item.id,role:source.role,...source.sourceSlotRole?{sourceSlotRole:source.sourceSlotRole}:{},sourceType:source.sourceType,sourceArtifactId:source.sourceArtifactId,sourceHash:source.sourceHash,sourceInputFingerprint:source.sourceInputFingerprint,...source.pairedColorHash?{pairedColorHash:source.pairedColorHash}:{}});
  }
 }
 const acceptedCurrent=props.some(item=>states.get(item.id)?.sheets?.some((sheet:any)=>sheet.fresh===true));
 const acceptedStale=props.some(item=>states.get(item.id)?.sheetCandidates?.some((sheet:any)=>sheet.status==='accepted'&&sheet.fresh!==true));
 const pendingSheets=props.flatMap(item=>(states.get(item.id)?.sheetCandidates||[]).filter((sheet:any)=>sheet.status==='pending').map((sheet:any)=>({itemId:item.id,...sheet})));
 const pendingCurrent=pendingSheets.find((sheet:any)=>sheet.fresh===true);
 const pendingStale=pendingSheets.some((sheet:any)=>sheet.fresh!==true);
 const itemsForSheet=sources.filter(source=>source.state==='ready').map(source=>({itemId:source.itemId,role:source.role}));
 return {
  ownerItemId,
  items:itemsForSheet,
  sources,
  dependencies,
  inputSnapshot,
  pendingCandidateId:pendingCurrent?.candidateId||null,
  pendingItemId:pendingCurrent?.itemId||null,
  pendingStale,
  acceptedCurrent,
  acceptedStale,
  // Preparing a sheet is an explicit user action. Keep accepted history intact
  // and allow a new candidate beside it, while avoiding duplicate pending work.
  ready:props.length>0&&!dependencies.length&&!pendingCurrent&&itemsForSheet.length===props.length,
 };
}
