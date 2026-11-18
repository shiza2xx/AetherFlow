import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import AnimatedActionButton from './AnimatedActionButton';
import notificationIcon from 'react-useanimations/lib/notification4';
import {Bell,Check,CircleAlert,X} from 'lucide-react';
import {formatNotice} from '../shared/ui-notices';
import {activeToastEntries,type NotificationInput,type NotificationState,unreadNotificationCount,visibleNotificationEntries} from './notificationStore';
import {notificationDiagnostic,redactNotificationDetail} from './notification-errors';
import {useNoticePanel} from './useNoticePanel';

type Props={
 locale:'en'|'ru';
 state:NotificationState;
 open:boolean;
 activity?:ReactNode;
 onToggle:()=>void;
 onClose:()=>void;
 onMarkRead:(key:string)=>void;
 onDismiss:(key:string)=>void;
 onClear:()=>void;
 onExpire:(now:number)=>void;
};

export default function NotificationCenter({locale,state,open,activity,onToggle,onClose,onMarkRead,onDismiss,onClear,onExpire}:Props){
 const ru=locale==='ru';
 const {anchor,panel,style,close}=useNoticePanel(open,onClose);
 const [now,setNow]=useState(Date.now);
 const active=activeToastEntries(state,Math.max(now,Date.now())).at(-1);
 const visible=visibleNotificationEntries(state);
 const unread=unreadNotificationCount(state);
 const overflow=state.overflow?.dismissedAt===null?state.overflow:null;
 const label=(item:NotificationInput)=>item.id?formatNotice(locale,item.id):item.message||'';
 const icon=(severity:NotificationInput['severity'])=>severity==='error'?<CircleAlert size={15}/>:severity==='success'?<Check size={15}/>:<Bell size={14}/>;
 const technicalDetails=(item:NotificationInput)=>{
  const diagnostic=item.severity==='error'
   ?notificationDiagnostic({code:item.code,message:item.detail},locale)
   :item.detail?{code:item.code||'APP_NOTICE',detail:redactNotificationDetail(item.detail)}:null;
  if(!diagnostic)return null;
  return <details><summary>{ru?'Технические сведения':'Technical details'}</summary><code>{diagnostic.code} · {diagnostic.detail}</code></details>;
 };
 useEffect(()=>{
  const next=state.entries.reduce((deadline,item)=>Math.min(deadline,item.toastUntil??Infinity),Infinity);
  if(!Number.isFinite(next))return;
  const timer=window.setTimeout(()=>{const time=Date.now();setNow(time);onExpire(time);},Math.max(0,next-Date.now()));
  return ()=>window.clearTimeout(timer);
 },[state.entries,onExpire]);
 const actions=(key:string,readAt:number|null)=><div className="notification-actions">
  {readAt===null&&<button type="button" aria-label={ru?'Отметить прочитанным':'Mark as read'} onClick={()=>onMarkRead(key)}><Check size={13}/></button>}
  <button type="button" aria-label={ru?'Закрыть уведомление':'Dismiss notification'} onClick={()=>onDismiss(key)}><X size={13}/></button>
 </div>;
 return <>
  <div className="notification-anchor" ref={anchor}>
   <AnimatedActionButton animation={notificationIcon} iconSize={18} type="button" className="icon-button quiet notification-trigger" aria-label={ru?`Уведомления, непрочитанных: ${unread}`:`Notifications, unread: ${unread}`} aria-expanded={open} aria-haspopup="dialog" aria-controls={open?'notification-center':undefined} data-tooltip={ru?'Уведомления':'Notifications'} onClick={onToggle}>
    {unread>0&&<span className="notification-badge">{unread>99?'99+':unread}</span>}
   </AnimatedActionButton>
  </div>
  {open&&createPortal(<section ref={panel} className="notification-center" id="notification-center" role="dialog" aria-modal="false" tabIndex={-1} aria-label={ru?'Центр уведомлений':'Notification center'} style={style}>
   <header><strong>{ru?'Уведомления':'Notifications'}</strong><span>{unread?(ru?`Непрочитанных: ${unread}`:`${unread} unread`):(ru?'Всё прочитано':'All caught up')}</span></header>
   <div className="notification-list">
    {activity}
    {overflow&&<article className={`notification-overflow notification-${overflow.severity}`}>
     <strong>{ru?`Не сохранено уведомлений: ${overflow.count}`:`Notices not retained: ${overflow.count}`}</strong>
     <p>{label(overflow.last)}</p>{technicalDetails(overflow.last)}{actions('overflow',overflow.readAt)}
    </article>}
    {visible.length===0&&!overflow&&!activity&&<div className="notification-empty">{ru?'Новых уведомлений нет.':'No notifications yet.'}</div>}
    {[...visible].reverse().map(item=><article key={item.key} className={`notification-entry notification-${item.severity}${item.readAt!==null?' is-read':''}`}>
     <span className="notification-icon" aria-hidden="true">{icon(item.severity)}</span>
     <div className="notification-copy">
      <strong>{label(item)}{item.count>1&&<small> · {item.count}</small>}</strong>
      <time>{new Date(item.createdAt).toLocaleTimeString(ru?'ru-RU':'en-US',{hour:'2-digit',minute:'2-digit'})}</time>
      {item.description&&<p>{item.description}</p>}
      {technicalDetails(item)}
     </div>
     {actions(item.key,item.readAt)}
    </article>)}
   </div>
   <footer><button type="button" onClick={onClear}>{ru?'Очистить прочитанные':'Clear read'}</button><button type="button" onClick={()=>close(true)}>{ru?'Закрыть':'Close'}</button></footer>
  </section>,document.body)}
  {active&&!open&&createPortal(<div className="notification-toast-stack">
   <article key={active.key} className={`notification-toast notification-${active.severity}`} role={active.severity==='error'?'alert':'status'}>
    <span aria-hidden="true">{icon(active.severity)}</span>
    <div><strong>{label(active)}{active.count>1&&<small> · {active.count}</small>}</strong>{active.description&&<p>{active.description}</p>}</div>
   </article>
  </div>,document.body)}
 </>;
}
