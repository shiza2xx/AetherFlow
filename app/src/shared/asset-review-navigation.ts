import type {Entity} from './contracts';

export type AssetReviewNavigationMode='color'|'depth';
export type AssetReviewNavigationEntry={
 itemId:string;
 itemName:string;
 role:string;
 candidateId:string;
 artifactId:string;
 hash:string;
 status:'pending';
 warnings:string[];
 eligible:boolean;
 key?:string;
 version?:string;
 blockedReason?:string;
};

type ReviewPlan={eligible?:Array<{itemId:string;role:string;candidateId:string;artifactId:string;hash:string;warnings?:string[];key:string;version:string}>;blocked?:Array<{itemId:string;role:string;candidateIds:string[];reason:string}>};
type NavigationContext={items:Entity[];workflow:Entity};

const colorRole=(role:string)=>role==='image'||role.startsWith('image:')||role.startsWith('foliage:')||role==='sheet';
const depthRole=(role:string)=>role==='depth'||role.startsWith('depth:');

function roleOrder(item:Entity,role:string,mode:AssetReviewNavigationMode){
 const view=role.includes(':')?role.slice(role.indexOf(':')+1):'';
 if(mode==='depth')return view==='front'?0:view==='side'?1:view==='sheet'?2:3;
 if(item.data.route==='foliage')return view==='front'?0:view==='back'?1:view==='side'?2:view==='top'?3:4;
 if(role==='image'||view==='front')return 0;
 if(view==='side')return 1;
 if(role==='sheet')return 2;
 return 3;
}

/** Build a stable, catalog-ordered review queue from every pending image candidate. */
export function assetReviewNavigationEntries(context:NavigationContext,plan:ReviewPlan,mode:AssetReviewNavigationMode):AssetReviewNavigationEntry[]{
 const itemsById=new Map(context.items.map(item=>[item.id,item]));
 const rank=new Map<string,number>((context.workflow.data.catalogItemOrder||[]).map((id:string,index:number)=>[id,index]));
 const eligible=new Map((plan.eligible||[]).map(row=>[`${row.itemId}\0${row.role}\0${row.candidateId}`,row]));
 const blocked=new Map<string,string>();
 for(const row of plan.blocked||[])for(const candidateId of row.candidateIds)blocked.set(`${row.itemId}\0${row.role}\0${candidateId}`,row.reason);
 const entries:AssetReviewNavigationEntry[]=[];
 for(const slot of context.workflow.data.slots as any[]||[]){
  if(!(mode==='color'?colorRole(slot.role):depthRole(slot.role)))continue;
  const item=itemsById.get(slot.itemId);if(!item)continue;
  for(const candidate of slot.candidates||[]){
   if(candidate.status!=='pending'||!candidate.artifactId)continue;
   const key=`${item.id}\0${slot.role}\0${candidate.id}`,review=eligible.get(key),blockedReason=blocked.get(key);
   entries.push({itemId:item.id,itemName:item.name,role:slot.role,candidateId:candidate.id,artifactId:candidate.artifactId,hash:String(candidate.hash||''),status:'pending',warnings:Array.isArray(candidate.warnings)?candidate.warnings:[],eligible:!!review,...review?{key:review.key,version:review.version}:blockedReason?{blockedReason}: {blockedReason:'Refresh image review to validate this candidate.'}});
  }
 }
 return entries.sort((a,b)=>{
  const left=rank.get(a.itemId),right=rank.get(b.itemId);
  if(left!==undefined||right!==undefined){if(left===undefined)return 1;if(right===undefined)return -1;if(left!==right)return left-right;}
  const itemA=itemsById.get(a.itemId)!,itemB=itemsById.get(b.itemId)!;
  const roleDiff=roleOrder(itemA,a.role,mode)-roleOrder(itemB,b.role,mode);
  if(roleDiff)return roleDiff;
  return a.candidateId.localeCompare(b.candidateId);
 });
}

export function assetReviewNavigationKey(entry:Pick<AssetReviewNavigationEntry,'itemId'|'role'|'candidateId'>){return `${entry.itemId}\0${entry.role}\0${entry.candidateId}`;}
