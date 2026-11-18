import {useEffect,useRef,useState} from 'react';
import {FileInput,X} from 'lucide-react';
import type {NotificationInput} from './notificationStore';
import {redactNotificationDetail} from './notification-errors';

type ImportPhase='reading'|'registered'|'processing'|'ready'|'error'|'cancelled';
type ImportActivity={event:'asset.import-progress';workspace:string;importId:string;name:string;phase:ImportPhase;operationId?:string;message?:string};
const waiting=(phase:ImportPhase)=>['reading','registered','processing'].includes(phase);
const labels={
 en:{reading:'Reading file…',registered:'File registered',processing:'Preparing model preview…',ready:'File imported',error:'Import could not finish',cancelled:'Processing cancelled'},
 ru:{reading:'Чтение файла…',registered:'Файл зарегистрирован',processing:'Подготовка предпросмотра модели…',ready:'Файл импортирован',error:'Не удалось завершить импорт',cancelled:'Обработка отменена'},
};

export function useImportActivity(workspace:string|undefined,locale:'en'|'ru',notify:(item:NotificationInput)=>void){
 const [activity,setActivity]=useState<ImportActivity[]>([]);
 const context=useRef({locale,notify});
 const previous=useRef(new Map<string,ImportPhase>());
 context.current={locale,notify};
 useEffect(()=>{
  previous.current.clear();
  setActivity([]);
  return window.atelier.onDomainEvent(raw=>{
   const next=raw as ImportActivity|undefined;
   if(next?.event!=='asset.import-progress'||next.workspace!==workspace||!next.importId||!Object.hasOwn(labels.en,next.phase))return;
   const lastPhase=previous.current.get(next.importId),{locale,notify}=context.current;
   previous.current.set(next.importId,next.phase);
   if(previous.current.size>100)previous.current.delete(previous.current.keys().next().value!);
   setActivity(rows=>[...rows.filter(row=>row.importId!==next.importId),next].slice(-20));
   if(lastPhase!==next.phase&&(next.phase==='reading'||!waiting(next.phase))){
    notify({message:labels[locale][next.phase],description:next.name,severity:next.phase==='error'?'error':next.phase==='ready'?'success':'info',detail:next.message});
   }
  });
 },[workspace]);
 return {
  activity:activity.filter(row=>row.workspace===workspace),
  dismiss:(id:string)=>setActivity(rows=>rows.filter(row=>row.importId!==id)),
 };
}

export function ImportProgress({activity,locale,dismiss}:{activity:ImportActivity[];locale:'en'|'ru';dismiss:(id:string)=>void}){
 const ru=locale==='ru';
 const [cancelling,setCancelling]=useState<string[]>([]);
 const [failed,setFailed]=useState<string[]>([]);
 const cancel=async(item:ImportActivity)=>{
  if(!item.operationId||cancelling.includes(item.importId))return;
  setCancelling(rows=>[...rows,item.importId]);
  setFailed(rows=>rows.filter(id=>id!==item.importId));
  try{
   const response=await window.atelier.call({op:'blender:job-cancel',id:item.operationId});
   if(!response.ok||!response.data.cancelled)throw new Error('Cancellation was not confirmed');
  }catch{
   setFailed(rows=>[...rows,item.importId]);
  }finally{
   setCancelling(rows=>rows.filter(id=>id!==item.importId));
  }
 };
 return <div className="notification-import-list" aria-label={ru?'Импорт файлов':'File imports'}>
  {[...activity].reverse().map(item=><article key={item.importId} className="notification-entry import-progress-entry" data-phase={item.phase}>
   <span className="notification-icon" aria-hidden="true"><FileInput size={15}/></span>
   <div className="notification-copy">
    <strong>{labels[locale][item.phase]}</strong>
    <p>{item.name}</p>
    {item.message&&<details><summary>{ru?'Подробности':'Details'}</summary><p>{redactNotificationDetail(item.message)}</p></details>}
    {waiting(item.phase)&&item.operationId&&<div className="notification-import-actions">
     <button type="button" className="subtle-button" disabled={cancelling.includes(item.importId)} onClick={()=>void cancel(item)}>{ru?'Отменить обработку':'Cancel processing'}</button>
     {failed.includes(item.importId)&&<p role="status">{ru?'Не удалось отменить. Обработка продолжается.':'Could not cancel. Processing is still running.'}</p>}
    </div>}
   </div>
   {!waiting(item.phase)&&<div className="notification-actions"><button type="button" aria-label={ru?'Скрыть статус импорта':'Hide import status'} onClick={()=>dismiss(item.importId)}><X size={14}/></button></div>}
  </article>)}
 </div>;
}
