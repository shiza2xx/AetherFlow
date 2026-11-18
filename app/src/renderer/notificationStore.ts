export const NOTIFICATION_LIMIT=100;
export type NotificationSeverity='info'|'success'|'error';
import type {NoticeId} from '../shared/ui-notices';
export type NotificationInput={id?:NoticeId;message?:string;severity:NotificationSeverity;detail?:string;code?:string;showInApp?:boolean;description?:string};
export type NotificationEntry=NotificationInput&{key:string;createdAt:number;count:number;readAt:number|null;dismissedAt:number|null;toastUntil:number|null};
export type NotificationOverflow={count:number;severity:NotificationSeverity;last:NotificationInput;createdAt:number;readAt:number|null;dismissedAt:number|null};
export type NotificationState={entries:NotificationEntry[];overflow:NotificationOverflow|null};
export const emptyNotifications:NotificationState={entries:[],overflow:null};
const transient=(input:NotificationInput,now:number)=>input.showInApp===false?null:now+(input.severity==='error'?8000:5000);
export function addNotification(state:NotificationState,input:NotificationInput,now=Date.now(),key=`notice-${now}`):NotificationState{
 if(state.entries.some(item=>item.key===key))return state;
 const last=input.showInApp===undefined?[...state.entries].reverse().find(item=>item.readAt===null&&item.dismissedAt===null&&item.id===input.id&&item.message===input.message&&item.description===input.description&&item.severity===input.severity&&item.showInApp===undefined&&now-item.createdAt<4000):undefined;
 if(last)return {...state,entries:state.entries.map(item=>item.key===last.key?{...item,count:item.count+1,createdAt:now,detail:input.detail??item.detail,code:input.code??item.code,toastUntil:transient(input,now)}:item)};
 let entries=[...state.entries];
 if(entries.length>=NOTIFICATION_LIMIT){
  let index=entries.findIndex(item=>item.readAt!==null||item.dismissedAt!==null);
  if(index<0)index=entries.findIndex(item=>item.severity!=='error'&&(item.toastUntil===null||item.toastUntil<=now));
  if(index<0)index=entries.findIndex(item=>item.severity!=='error');
  if(index>=0)entries.splice(index,1);
  else return {...state,overflow:{count:(state.overflow?.count||0)+1,severity:input.severity,last:input,createdAt:now,readAt:null,dismissedAt:null}};
 }
 entries.push({...input,key,createdAt:now,count:1,readAt:null,dismissedAt:null,toastUntil:transient(input,now)});return {...state,entries};
}
export function expireNotifications(state:NotificationState,now:number):NotificationState{return {...state,entries:state.entries.map(item=>item.toastUntil!==null&&item.toastUntil<=now?{...item,toastUntil:null}:item)}}
export function markNotificationRead(state:NotificationState,key:string,now=Date.now()):NotificationState{return key==='overflow'&&state.overflow?{...state,overflow:{...state.overflow,readAt:now}}:{...state,entries:state.entries.map(item=>item.key===key?{...item,readAt:now,toastUntil:null}:item)}}
export function dismissNotification(state:NotificationState,key:string,now=Date.now()):NotificationState{return key==='overflow'&&state.overflow?{...state,overflow:{...state.overflow,readAt:now,dismissedAt:now}}:{...state,entries:state.entries.map(item=>item.key===key?{...item,readAt:now,dismissedAt:now,toastUntil:null}:item)}}
export function clearReadNotifications(state:NotificationState):NotificationState{return {entries:state.entries.filter(item=>item.readAt===null&&item.dismissedAt===null),overflow:state.overflow&&(state.overflow.readAt===null&&state.overflow.dismissedAt===null)?state.overflow:null}}
export function visibleNotificationEntries(state:NotificationState):NotificationEntry[]{return state.entries.filter(item=>item.dismissedAt===null)}
export function unreadNotificationCount(state:NotificationState):number{return state.entries.filter(item=>item.readAt===null&&item.dismissedAt===null).length+(state.overflow&&state.overflow.readAt===null&&state.overflow.dismissedAt===null?1:0)}
export function activeToastEntries(state:NotificationState,now:number):NotificationEntry[]{return state.entries.filter(item=>item.dismissedAt===null&&item.readAt===null&&item.toastUntil!==null&&item.toastUntil>now)}
