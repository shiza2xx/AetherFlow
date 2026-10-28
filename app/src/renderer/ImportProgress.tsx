import {useEffect,useRef} from 'react';
import {toast} from 'sonner';
import {Check,FileInput,X} from 'lucide-react';
type ImportEvent={event:string;importId:string;name:string;phase:'reading'|'registered'|'processing'|'ready'|'error'|'cancelled';operationId?:string;message?:string};
export function ImportProgress({locale}:{locale:string}){
 const latest=useRef<ImportEvent|undefined>(undefined),hiddenImports=useRef(new Set<string>());
 useEffect(()=>{const hidden=hiddenImports.current;let current=latest.current;const id='aetherflow-file-import',ru=locale==='ru',t=(en:string,r:string)=>ru?r:en;
  const render=(next:ImportEvent)=>{current=next;latest.current=next;if(hidden.has(next.importId))return;
   const waiting=['reading','registered','processing'].includes(next.phase),labels={reading:t('Reading file…','Чтение файла…'),registered:t('File registered','Файл зарегистрирован'),processing:t('Processing model · preparing preview…','Обработка модели · подготовка предпросмотра…'),ready:t('File imported','Файл импортирован'),error:t('Import could not finish','Не удалось завершить импорт'),cancelled:t('Processing cancelled','Обработка отменена')};
   const hide=()=>{hidden.add(next.importId);toast.dismiss(id)};
   toast.custom(()=> <article className="update-toast import-progress-toast" data-phase={next.phase} aria-busy={waiting}>
    <div className="update-toast-icon">{waiting?<span className="activity-dots" aria-hidden="true"><i/><i/><i/></span>:next.phase==='ready'?<Check size={20}/>:<FileInput size={20}/>}</div>
    <div className="update-toast-copy"><strong role="status">{labels[next.phase]}</strong><p className="import-progress-name" title={next.name}>{next.name}</p>{(next.phase==='error'||next.phase==='cancelled')&&<p>{t('Your source file is unchanged. Use the upload target again to retry.','Исходный файл не изменён. Повторите загрузку через ту же область импорта.')}</p>}
     {next.message&&<details><summary>{t('Details','Подробности')}</summary><p>{next.message}</p></details>}
     {waiting&&next.operationId&&<div className="update-toast-actions"><button className="subtle-button" onClick={async event=>{const button=event.currentTarget;button.disabled=true;try{const response=await window.atelier.call({op:'blender:job-cancel',id:next.operationId!});if(!response.ok||!response.data.cancelled)throw new Error('Cancellation was not confirmed');}catch{if(current?.importId===next.importId){button.disabled=false;toast.error(t('Could not cancel. Processing is still running.','Не удалось отменить. Обработка продолжается.'));}}}}>{t('Cancel processing','Отменить обработку')}</button></div>}
    </div><button className="update-toast-dismiss" onClick={hide} aria-label={t('Hide import status','Скрыть статус импорта')}><X size={16}/></button>
   </article>,{id,duration:waiting||next.phase==='error'?Infinity:5000,dismissible:false});
  };const off=window.atelier.onDomainEvent((raw:unknown)=>{const next=raw as ImportEvent;if(next?.event==='asset.import-progress'&&next.importId)render(next)});if(current&&['reading','registered','processing','error'].includes(current.phase))render(current);return()=>off();
 },[locale]);return null;
}
