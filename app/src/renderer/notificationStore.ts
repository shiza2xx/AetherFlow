export const NOTIFICATION_LIMIT=100;
export type NotificationSeverity='info'|'success'|'error';
import type {NoticeId} from '../shared/ui-notices';
export type NotificationInput={id?:NoticeId;message?:string;severity:NotificationSeverity;detail?:string;code?:string};
export type NotificationEntry=NotificationInput&{key:string;createdAt:number;count:number;readAt:number|null;dismissedAt:number|null;toastUntil:number|null};
export type NotificationOverflow={count:number;severity:NotificationSeverity;last:NotificationInput;createdAt:number;readAt:number|null;dismissedAt:number|null};
export type NotificationState={entries:NotificationEntry[];overflow:NotificationOverflow|null};
export const emptyNotifications:NotificationState={entries:[],overflow:null};
const transient=(severity:NotificationSeverity)=>severity==='error'?null:5000;
export function addNotification(state:NotificationState,input:NotificationInput,now=Date.now(),key=`notice-${now}`):NotificationState{
 const last=[...state.entries].reverse().find(item=>item.readAt===null&&item.dismissedAt===null&&item.id===input.id&&item.message===input.message&&item.severity===input.severity&&now-item.createdAt<4000);
 if(last)return {...state,entries:state.entries.map(item=>item.key===last.key?{...item,count:item.count+1,createdAt:now,detail:input.detail??item.detail,code:input.code??item.code,toastUntil:transient(item.severity)===null?null:now+transient(item.severity)!}:item)};
 let entries=[...state.entries];
 if(entries.length>=NOTIFICATION_LIMIT){
  let index=entries.findIndex(item=>item.readAt!==null||item.dismissedAt!==null);
  if(index<0)index=entries.findIndex(item=>item.severity!=='error'&&(item.toastUntil===null||item.toastUntil<=now));
  if(index<0)index=entries.findIndex(item=>item.severity!=='error');
  if(index>=0)entries.splice(index,1);
  else return {...state,overflow:{count:(state.overflow?.count||0)+1,severity:input.severity,last:input,createdAt:now,readAt:null,dismissedAt:null}};
 }
 const duration=transient(input.severity);entries.push({...input,key,createdAt:now,count:1,readAt:null,dismissedAt:null,toastUntil:duration===null?null:now+duration});return {...state,entries};
}
export function expireNotifications(state:NotificationState,now:number):NotificationState{return {...state,entries:state.entries.map(item=>item.toastUntil!==null&&item.toastUntil<=now?{...item,toastUntil:null}:item)}}
export function resumePausedNotifications(state:NotificationState,pauseStart:number,resumeAt:number):NotificationState{return {...state,entries:state.entries.map(item=>{if(item.toastUntil===null||item.readAt!==null||item.dismissedAt!==null)return item;const remaining=Math.max(0,item.toastUntil-Math.max(pauseStart,item.createdAt));return {...item,toastUntil:resumeAt+remaining}})}}
export function markNotificationRead(state:NotificationState,key:string,now=Date.now()):NotificationState{return key==='overflow'&&state.overflow?{...state,overflow:{...state.overflow,readAt:now}}:{...state,entries:state.entries.map(item=>item.key===key?{...item,readAt:now,toastUntil:null}:item)}}
export function dismissNotification(state:NotificationState,key:string,now=Date.now()):NotificationState{return key==='overflow'&&state.overflow?{...state,overflow:{...state.overflow,readAt:now,dismissedAt:now}}:{...state,entries:state.entries.map(item=>item.key===key?{...item,readAt:now,dismissedAt:now,toastUntil:null}:item)}}
export function clearReadNotifications(state:NotificationState):NotificationState{return {entries:state.entries.filter(item=>item.readAt===null&&item.dismissedAt===null),overflow:state.overflow&&(state.overflow.readAt===null&&state.overflow.dismissedAt===null)?state.overflow:null}}
export function visibleNotificationEntries(state:NotificationState):NotificationEntry[]{return state.entries.filter(item=>item.dismissedAt===null)}
export function unreadNotificationCount(state:NotificationState):number{return state.entries.filter(item=>item.readAt===null&&item.dismissedAt===null).length+(state.overflow&&state.overflow.readAt===null&&state.overflow.dismissedAt===null?1:0)}
export function activeToastEntries(state:NotificationState,now:number):NotificationEntry[]{return state.entries.filter(item=>item.dismissedAt===null&&item.readAt===null&&(item.severity==='error'||(item.toastUntil!==null&&item.toastUntil>now)))}
