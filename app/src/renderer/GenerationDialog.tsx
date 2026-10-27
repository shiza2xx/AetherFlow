import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,Copy,Sparkles,X} from 'lucide-react';
import type {Entity} from '../shared/contracts';
import type {Locale} from '../shared/i18n';
import {localizedSlotRole} from '../shared/i18n';
import {call} from './api';
import {Artwork,referenceIds} from './Artwork';

type Spec={title:string;target:'Head + Body reference set'|'Separate Parts';views:string[];parts:string;style:string;asymmetry:boolean;background:'white'|'transparent';repairTarget:string};
export default function GenerationDialog({locale,workspace,ownerId,entities,onClose,onPrepared}:{locale:Locale;workspace:string;ownerId?:string;entities:Entity[];onClose:()=>void;onPrepared:()=>void}){
  const ru=locale==='ru',t=(en:string,ruText:string)=>ru?ruText:en;
  const choices=entities.filter(item=>item.kind==='concept'&&(referenceIds(item.data).length||item.id===ownerId)||item.kind==='character'&&item.id===ownerId);
  const [id,setId]=useState(ownerId||choices[0]?.id||''),[owner,setOwner]=useState<Entity>(),[sources,setSources]=useState<Entity[]>([]),[selected,setSelected]=useState<string[]>([]);
  const [spec,setSpec]=useState<Spec>({title:'',target:'Head + Body reference set',views:['front','left','right','back'],parts:'',style:'',asymmetry:true,background:'white',repairTarget:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[slots,setSlots]=useState<any[]>([]),[loading,setLoading]=useState(true);
  const prepared=useRef<{key:string;data:any}|undefined>(undefined),live=useRef(true);
  useEffect(()=>{live.current=true;return ()=>{live.current=false;};},[]);
  useEffect(()=>{let active=true;setLoading(true);setError('');prepared.current=undefined;
    if(!id){setLoading(false);return;}
    void call({op:'generation:context',entityId:id}).then(result=>{
      if(!active)return;setLoading(false);if(!result.ok){setError(result.error.message);return;}
      setOwner(result.data.entity);setSources(result.data.sources);setSelected(Array.isArray(result.data.entity.data.generationReferenceIds)?result.data.entity.data.generationReferenceIds.filter((id:string)=>result.data.sources.some((item:Entity)=>item.id===id)):result.data.sources.map((item:Entity)=>item.id));
      setSpec(value=>({...value,...result.data.entity.data.promptSpec,title:result.data.entity.name,parts:result.data.entity.data.promptSpec?.parts||(result.data.entity.data.partInventory||[]).map((part:any)=>part.name).join('\n'),target:result.data.entity.data.template==='separate-parts'?'Separate Parts':'Head + Body reference set'}));
    });return ()=>{active=false;};
  },[id]);
  async function perform(action:'open'|'copy'){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{
      const key=JSON.stringify({id,selected,spec,locale});
      if(prepared.current?.key!==key){
        const result=await call({op:'generation:prepare',entityId:id,referenceIds:selected,spec:spec as any});
        if(!result.ok)throw new Error(result.error.message);
        prepared.current={key,data:result.data};setSlots(result.data.request.data.slots||[]);onPrepared();
      }
      const data=prepared.current!.data;
      const result=action==='open'?await call({op:'codex:open-session',requestId:data.request.id}):await call({op:'prompt:copy',text:data.markdown});
      if(!result.ok)throw new Error(result.error.message);
      if(live.current)setNotice(action==='open'?t('Codex is open. Copy the prompt, then paste and send it in the terminal.','Codex открыт. Скопируйте промпт, затем вставьте и отправьте его в терминале.'):t('Prompt copied in English. Paste and send it in Codex.','Промпт скопирован на русском. Вставьте и отправьте его в Codex.'));
    }catch(error){if(live.current)setError(error instanceof Error?error.message:String(error));}
    finally{if(live.current)setBusy(false);}
  }
  const viewName=(view:string)=>ru?({front:'Спереди',left:'Слева',right:'Справа',back:'Сзади'} as Record<string,string>)[view]:({front:'Front',left:'Left',right:'Right',back:'Back'} as Record<string,string>)[view];
  return <div className="overlay" onMouseDown={event=>event.target===event.currentTarget&&!busy&&onClose()}><section role="dialog" aria-modal="true" aria-labelledby="generation-title" className="dialog generation-dialog" data-testid="generation-dialog">
    <header className="dialog-head"><div><h2 id="generation-title">{t('Generate references','Генерация референсов')}</h2><p>{t('Your artwork is the starting point. Open Codex, then paste your prepared prompt.','Ваш арт — отправная точка. Откройте Codex и вставьте подготовленный промпт.')}</p></div><button className="icon-button" disabled={busy} aria-label={t('Close','Закрыть')} onClick={onClose}><X size={18}/></button></header>
    <div className="generation-body"><div className="generation-sources"><h3>{t('Source artwork','Исходные изображения')}</h3>{!ownerId&&choices.length>1&&<div className="generation-owner-list">{choices.map(choice=><button className={id===choice.id?'selected':''} disabled={busy} key={choice.id} onClick={()=>setId(choice.id)}>{choice.name}</button>)}</div>}
      {loading?<p>{t('Loading references…','Загрузка референсов…')}</p>:sources.length?<div className="generation-art-grid">{sources.map(source=><button type="button" key={source.id} className={`generation-source ${selected.includes(source.id)?'selected':''}`} aria-pressed={selected.includes(source.id)} aria-label={`${t('Use source','Использовать исходник')}: ${source.name}`} disabled={busy} onClick={()=>setSelected(ids=>ids.includes(source.id)?ids.filter(value=>value!==source.id):[...ids,source.id])}><Artwork id={source.id} alt={source.name} locale={locale} workspace={workspace}/><span>{source.name}</span><i><Check size={12}/></i></button>)}</div>:<p>{t('Add artwork to Gallery first, then return here.','Сначала добавьте арт в Галерею, затем вернитесь сюда.')}</p>}
      <p className="generation-source-note">{t('Original files are preserved. Codex receives verified working copies and the character workflow.','Оригиналы сохранены. Codex получит проверенные рабочие копии и workflow персонажа.')}</p></div>
      <div className="generation-options"><div className="field-label">{t('Production route','Маршрут производства')}<div className="prompt-targets">{(['Head + Body reference set','Separate Parts'] as const).map(target=><button type="button" key={target} disabled={busy||slots.length>0||owner?.kind==='character'||owner?.data.productionStarted} className={spec.target===target?'selected':''} aria-pressed={spec.target===target} onClick={()=>setSpec(value=>({...value,target}))}>{target==='Separate Parts'?t('Separate parts','Отдельные части'):t('Head & body','Голова и тело')}</button>)}</div></div>
      <div className="generation-sequence"><Sparkles size={18}/><p>{spec.target==='Separate Parts'?t('Full body → base body → head → hair → named garments and accessories. Each result has its own workflow slot.','Полный персонаж → базовое тело → голова → волосы → указанные предметы одежды и аксессуары. Для каждого результата есть отдельный слот.'):t('8 head & body views → 3 full-body balance views → your review.','8 ракурсов головы и тела → 3 ракурса баланса полного тела → ваша проверка.')}</p></div>
      {spec.target==='Head + Body reference set'&&<div className="field-label">{t('Head & body views','Ракурсы головы и тела')}<div className="prompt-chips">{['front','left','right','back'].map(view=><button type="button" disabled={busy} key={view} aria-pressed={spec.views.includes(view)} className={spec.views.includes(view)?'selected':''} onClick={()=>setSpec(value=>({...value,views:value.views.includes(view)?value.views.filter(item=>item!==view):[...value.views,view]}))}>{viewName(view)}</button>)}</div></div>}
      {spec.target==='Separate Parts'&&<label className="field-label">{t('Garments and accessories, one per line','Одежда и аксессуары, по одному на строку')}<textarea disabled={busy||Boolean(owner?.data.productionStarted)||owner?.kind==='character'} rows={3} value={spec.parts} onChange={event=>setSpec({...spec,parts:event.target.value})}/></label>}
      <label className="field-label">{t('Style & details to preserve','Стиль и детали для сохранения')}<textarea disabled={busy} rows={4} value={spec.style} onChange={event=>setSpec({...spec,style:event.target.value})} placeholder={t('Materials, expression, proportions, details…','Материалы, выражение лица, пропорции, детали…')}/></label>
      <div className="field-label">{t('Background','Фон')}<div className="segmented">{(['white','transparent'] as const).map(value=><button disabled={busy} className={spec.background===value?'selected':''} key={value} onClick={()=>setSpec({...spec,background:value})}>{value==='white'?t('White','Белый'):t('Transparent','Прозрачный')}</button>)}</div></div>
      {slots.length>0&&<details className="generation-output-details"><summary>{t('Prepared workflow outputs','Подготовленные слоты workflow')} · {slots.length}</summary>{slots.map(slot=><span key={slot.id}>{localizedSlotRole(slot.role,locale)}</span>)}</details>}
      </div></div>
    <footer className="generation-footer"><p role={error?'alert':'status'} className={error?'generation-error':'generation-notice'}>{error||notice||t('1. Open Codex   2. Copy prompt   3. Paste & send','1. Откройте Codex   2. Скопируйте промпт   3. Вставьте и отправьте')}</p><div><button className="primary-button" disabled={busy||loading||!selected.length||!spec.views.length} onClick={()=>void perform('open')}><ArrowUpRight size={15}/>{t('Open Codex','Открыть Codex')}</button><button className="subtle-button" disabled={busy||loading||!selected.length||!spec.views.length} onClick={()=>void perform('copy')}><Copy size={15}/>{t('Copy prompt','Скопировать промпт')}</button></div></footer>
  </section></div>;
}
