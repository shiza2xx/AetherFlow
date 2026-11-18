import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,LoaderCircle,Save} from 'lucide-react';
import {call} from './api';
import type {Locale} from '../shared/i18n';
import type {ReferenceDraftStatus} from '../shared/production-notices';
import './referencePlanEditor.css';

export type PlanData={ownerId:string;ownerKind:'character'|'assetJob';ownerRevision:number;enabled:boolean;markdown:string;lineageHash:string;sourceHash:string;sourceCount:number;sourceNames:string[];isCurrent:boolean;active:boolean;busy:boolean;codexDraftId?:string|null;codexDraftStatus?:ReferenceDraftStatus['status'];run?:{status:string;message?:string}|null};
export type PlanAction='running'|'error'|null;
export function referencePlanContinueMode(plan:Pick<PlanData,'enabled'|'active'>,skipPlan:boolean){
 if(!plan.enabled)return 'next';
 if(skipPlan)return 'skip';
 if(plan.active)return 'next-with-plan';
 return 'prompt';
}
type Props={ownerKind:'character'|'assetJob';ownerId:string;ownerRevision:number;workspace:string;workspaceInstanceId:string;locale:Locale;busy?:boolean;continueState?:PlanAction;onStateChange:(state:PlanData|null)=>void;onSavingChange:(saving:boolean)=>void;onImported?:()=>void|Promise<void>};
async function rpc(input:any){const result=await call(input);if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});return result.data;}

export function referencePlanActions(data:PlanData|null,action:PlanAction){
 const running=action==='running'||!!data?.busy||data?.run?.status==='running';
 const retry=!!data?.enabled&&!running&&(action==='error'||(!data.active&&['error','interrupted','stale'].includes(data.run?.status||'')));
 return {running,retry};
}

export function ReferencePlanContinue({locale,data,action,disabled,onContinue}:{
 locale:Locale;data:PlanData|null;action:PlanAction;disabled:boolean;onContinue:(skipPlan:boolean)=>void;
}){
 const {running,retry}=referencePlanActions(data,action),ru=locale==='ru';
 return <>
  {retry&&<button type="button" className="subtle-button" data-testid="reference-plan-skip" disabled={disabled} onClick={()=>onContinue(true)}>
   {ru?'Продолжить без плана':'Continue without a plan'}
  </button>}
  <button type="button" className="primary-button journey-continue" data-sound-event="silent" disabled={disabled||!data||running} onClick={()=>onContinue(false)}>
   {running?<><LoaderCircle size={15} className="reference-plan-spinner"/>{ru?'Подготовка плана…':'Preparing plan…'}</>:<>{ru?'Продолжить':'Continue'}<ArrowRight size={16}/></>}
  </button>
 </>;
}

export default function ReferencePlanEditor({ownerKind,ownerId,ownerRevision,workspace,workspaceInstanceId,locale,busy=false,continueState=null,onStateChange,onSavingChange,onImported}:Props){
 const ru=locale==='ru',t=(en:string,rus:string)=>ru?rus:en;
 const [data,setData]=useState<PlanData|null>(null),[draft,setDraft]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [importError,setImportError]=useState(false),importedCallback=useRef(onImported);
 importedCallback.current=onImported;
 const pendingDraft=data?.enabled&&!data.active&&!data.busy?data.codexDraftId:null;
 const refresh=useCallback(async()=>{try{const next=await rpc({op:'reference-plan:get',ownerKind,ownerId,workspace,workspaceInstanceId});setError('');setData(next);setImportError(next.codexDraftStatus==='invalid');setDraft(next.markdown||'');onStateChange?.(next);}catch(caught){setError(caught instanceof Error?caught.message:String(caught));setData(null);onStateChange?.(null);}},[ownerKind,ownerId,workspace,workspaceInstanceId,onStateChange]);
 useEffect(()=>{void refresh();},[refresh,ownerRevision]);
 useEffect(()=>{if(continueState==='error')void refresh();},[continueState,refresh]);
 useEffect(()=>window.atelier.onDomainEvent((raw:unknown)=>{
  const event=raw as ReferenceDraftStatus|undefined;
  if(event?.event!=='reference-plan.draft-status'||event.workspace!==workspace||event.workspaceInstanceId!==workspaceInstanceId||event.ownerKind!==ownerKind||event.ownerId!==ownerId||event.draftId!==pendingDraft)return;
  setImportError(event.status==='invalid');
  if(event.status==='imported')void importedCallback.current?.();
 }),[pendingDraft,ownerKind,ownerId,workspace,workspaceInstanceId]);
 const run=async(action:()=>Promise<unknown>)=>{setSaving(true);onSavingChange(true);setError('');try{await action();await refresh();}catch(caught){setError(caught instanceof Error?caught.message:String(caught));}finally{setSaving(false);onSavingChange(false);}};
 const toggle=(enabled:boolean)=>data&&void run(async()=>{await rpc({op:'reference-plan:toggle',ownerKind,ownerId,enabled,expectedRevision:data.ownerRevision,lineageHash:data.lineageHash,workspace,workspaceInstanceId});});
 const save=()=>data&&void run(async()=>{await rpc({op:'reference-plan:save',ownerKind,ownerId,markdown:draft,expectedRevision:data.ownerRevision,lineageHash:data.lineageHash,workspace,workspaceInstanceId});});
 const {running,retry}=referencePlanActions(data,continueState);
 const tStatus=()=>{
  if(running)return t('Astra is preparing the plan…','Astra готовит план…');
  if(!data?.enabled)return '';
  if(data?.active)return t('Current plan is ready and will guide later stages.','Актуальный план готов и будет передан следующим этапам.');
  if(pendingDraft)return importError?t('The plan file could not be read. Ask Codex to finish or fix the plan.','Пока не удалось прочитать готовый план. Попросите Codex завершить или исправить файл.'):t('The app will continue as soon as Codex saves the plan.','Когда Codex сохранит план, приложение продолжит автоматически.');
  if(data?.run?.status==='error'||continueState==='error')return t('Automatic analysis failed. Choose Continue to open the Codex prompt.','Автоматический анализ завершился ошибкой. Нажмите «Продолжить», чтобы открыть промпт для Codex.');
  if(data?.run?.status==='interrupted')return t('Analysis was interrupted. Choose Continue to open the Codex prompt.','Анализ прерван. Нажмите «Продолжить», чтобы открыть промпт для Codex.');
  if(data?.run?.status==='stale'||data?.markdown&&!data.isCurrent)return t('This saved plan is stale because its source or brief changed.','Сохранённый план устарел: изменился исходник или описание.');
  return t('Choose Continue to open the reference analysis prompt.','Нажмите «Продолжить», чтобы открыть промпт для анализа референса.');
 };
 const enabled=!!data?.enabled,dirty=!!data&&draft.trim()!==data.markdown.trim(),status=tStatus();
 return <section className="reference-plan-editor" data-testid={`reference-plan-${ownerKind}`} aria-label={t('Astra reference plan','План референса с Astra')}>
  <label className="reference-plan-toggle"><input type="checkbox" checked={enabled} disabled={busy||saving||running||!data} onChange={event=>toggle(event.target.checked)}/><span>{t('Prepare a reference plan with Astra','Подготовить план по референсу с Astra')}</span></label>
  {status&&<span className={`reference-plan-status${retry?' is-error':''}`} role="status">{running?<LoaderCircle size={14} className="reference-plan-spinner"/>:data?.active?<Check size={14}/>:null}{status}</span>}
  {error&&<p className="reference-plan-error" role="alert">{error}</p>}
  {!data&&error&&<div><button type="button" className="subtle-button" disabled={saving||busy} onClick={()=>void refresh()}>{t('Retry loading','Повторить загрузку')}</button></div>}
  {data?.markdown&&<details className="reference-plan-details">
   <summary>{t('Open plan','Открыть план')}</summary>
   <textarea aria-label={t('Reference plan Markdown','План референса в Markdown')} value={draft} disabled={busy||saving||running} onChange={event=>setDraft(event.target.value)} rows={9} maxLength={60000}/>
   <div className="reference-plan-actions"><button type="button" className="subtle-button" disabled={busy||saving||running||!dirty||!data.sourceCount} onClick={save}><Save size={14}/>{t('Save new version','Сохранить новую версию')}</button></div>
  </details>}
 </section>;
}
