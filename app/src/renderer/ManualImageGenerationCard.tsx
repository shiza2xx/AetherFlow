import {useEffect,useRef,useState} from 'react';
import {Clipboard,FileImage,Upload} from 'lucide-react';
import type {Locale} from '../shared/i18n';
import {Artwork} from './Artwork';

export type ManualImageReference={artifactId?:string;hash:string;name:string;role:string;path:string;source:'managed'|'depth-style';bytes:number};
export type ManualImageCardData={itemId:string;itemName:string;route:string;role:string;view:string;viewLabel:string;mode:'color'|'depth';status:string;inputFingerprint:string|null;pairedColorHash?:string;pairedSheetHash?:string;preparationRequest:string|null;externalPrompt:string|null;promptLineageHash:string|null;references:ManualImageReference[];blockedReason?:string;candidateIds:string[];lineage:{jobId:string;workflowRevision:number;itemRevision:number;inputFingerprint:string|null;pairedColorHash?:string;pairedSheetHash?:string;promptLineageHash:string|null}};

export function ManualImageGenerationCard({card,locale,workspace,busy=false,onCopyPreparationRequest,onCopyPrompt,onCopyPath,onOpenFolder,onOpenCodex,onSavePrompt,onFiles}:{card:ManualImageCardData;locale:Locale;workspace:string;busy?:boolean;onCopyPreparationRequest:(request:string)=>void;onCopyPrompt:(prompt:string)=>void;onCopyPath:(path:string)=>void;onOpenFolder:()=>void;onOpenCodex:()=>void;onSavePrompt:(prompt:string)=>void;onFiles:(files:FileList)=>void}){
 const input=useRef<HTMLInputElement>(null),[dragging,setDragging]=useState(false),[draft,setDraft]=useState(card.externalPrompt||''),ru=locale==='ru',t=(en:string,rus:string)=>ru?rus:en;
 useEffect(()=>setDraft(card.externalPrompt||''),[card.promptLineageHash,card.externalPrompt]);
 const dirty=draft.trim()!==(card.externalPrompt||''),status=card.status==='accepted-and-pending'?t('Accepted · new draft pending','Принято · новый вариант ожидает проверки'):card.status==='accepted'?t('Accepted','Принято'):card.status==='pending'?t('Awaiting review','Ожидает проверки'):card.status==='stale'?t('Stale input','Устаревший вход'):t('Ready for a prompt','Готово к промпту');
 const drop=(files:FileList)=>onFiles(files);
 return <article className="manual-image-card" data-testid="manual-image-card" data-item-id={card.itemId} data-role={card.role} data-mode={card.mode} data-prompt-lineage={card.promptLineageHash||''}>
  <header className="manual-image-card-header"><div><strong>{card.itemName}</strong><span>{card.viewLabel} · {card.mode==='depth'?t('Depth map','Карта глубины'):t('Color view','Цветной ракурс')}</span></div><small>{status}</small></header>
  <p className="manual-image-card-scope">{t('One external image for this exact item and view. Its candidate stays pending until you review it.','Одно внешнее изображение для этой детали и ракурса. Кандидат останется ожидающим до вашей проверки.')}</p>
  <details className="manual-image-card-references" open><summary>{t('Exact reference images','Точные изображения-референсы')} · {card.references.length}</summary>
   {card.references.length>0?<><button type="button" className="text-button manual-image-open-folder" disabled={busy} onClick={onOpenFolder}>{t('Open reference folder','Открыть папку референсов')}</button><div className="manual-image-references">{card.references.map((reference,index)=><figure key={`${reference.hash}-${index}`} data-reference-hash={reference.hash}>
    {reference.artifactId?<Artwork id={reference.artifactId} alt={reference.name} locale={locale} workspace={workspace}/>:<Artwork path={reference.path} alt={reference.name} locale={locale} workspace={workspace}/>}
    <figcaption><strong>{reference.name}</strong><small>{localizedReferenceRole(reference.role,locale)}</small><button type="button" className="text-button" disabled={busy} onClick={()=>onCopyPath(reference.path)}><Clipboard size={13}/>{t('Copy file path','Копировать путь к файлу')}</button><details><summary>{t('File diagnostics','Сведения о файле')}</summary><code title={reference.path}>{reference.path}</code><code>{t('SHA-256','SHA-256')}: {reference.hash}</code></details></figcaption>
   </figure>)}</div></>:<p role="alert">{card.blockedReason||t('No verified image references are available.','Проверенные изображения-референсы недоступны.')}</p>}
  </details>
  <section className="manual-image-generator-prompt" aria-label={t('Plain-text image generator prompt','Обычный текстовый промпт для генератора изображений')}>
   <label><span>{t('Prompt for the image generator','Промпт для генератора изображений')}</span><small>{card.externalPrompt?t('Saved. Edit and save again to update it.','Сохранён. Измените текст и сохраните его снова, чтобы обновить.'):t('Not prepared yet. Ask Codex for this slot, then paste its plain-text answer here.','Пока не подготовлен. Попросите Codex подготовить этот слот и вставьте сюда его текстовый ответ.')}</small><textarea rows={6} maxLength={20000} value={draft} onChange={event=>setDraft(event.target.value)} placeholder={t('Paste only the natural-language image description. No JSON or service commands.','Вставьте только описание изображения обычным текстом. Без JSON и служебных команд.')}/></label>
   <div className="manual-image-prompt-actions"><button type="button" className="primary-button" disabled={busy||!dirty||draft.trim().length<24||!card.promptLineageHash} onClick={()=>onSavePrompt(draft)}>{t('Save prompt','Сохранить промпт')}</button><button type="button" className="subtle-button" disabled={busy||!card.externalPrompt||dirty} onClick={()=>onCopyPrompt(draft)}><Clipboard size={14}/>{t('Copy image prompt','Копировать промпт для генератора')}</button></div>
   {card.preparationRequest?<details className="manual-image-preparation-request"><summary>{t('Codex preparation request · not the image prompt','Запрос для Codex · это не промпт для изображения')}</summary><p>{t('Copy this request into Codex. It asks for prompt text only and forbids image generation.','Скопируйте этот запрос в Codex. Он просит только подготовить текст и запрещает генерировать изображение.')}</p><pre>{card.preparationRequest}</pre><div className="manual-image-prompt-actions"><button type="button" className="subtle-button" disabled={busy} onClick={()=>onCopyPreparationRequest(card.preparationRequest!)}>{t('Copy request for Codex','Копировать запрос для Codex')}</button><button type="button" className="subtle-button" disabled={busy} onClick={onOpenCodex}>{t('Open Codex terminal','Открыть терминал Codex')}</button></div></details>:<p className="manual-image-blocked" role="status">{card.blockedReason}</p>}
  </section>
  <div className={`manual-image-drop${dragging?' is-dragging':''}`} onDragEnter={event=>{event.preventDefault();setDragging(true);}} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';}} onDragLeave={event=>{if(event.currentTarget===event.target)setDragging(false);}} onDrop={event=>{event.preventDefault();event.stopPropagation();setDragging(false);drop(event.dataTransfer.files);}}>
   <FileImage size={17}/><span><strong>{t('Drop one image into this slot','Перетащите одно изображение в этот слот')} · {card.viewLabel}</strong><small>PNG · JPEG · WebP</small></span><button type="button" className="subtle-button" disabled={busy||!card.promptLineageHash} onClick={()=>input.current?.click()}><Upload size={14}/>{t('Choose image','Выбрать изображение')}</button>
  </div>
  <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{if(event.currentTarget.files?.length===1)drop(event.currentTarget.files);event.currentTarget.value='';}}/>
  <details className="manual-image-card-diagnostics"><summary>{t('Target and lineage details','Цель и происхождение')}</summary><code>{card.itemId} · {card.role}</code>{card.promptLineageHash&&<code>SHA-256: {card.promptLineageHash}</code>}{(card.pairedColorHash||card.pairedSheetHash)&&<code>{t('Paired input','Парный вход')}: {card.pairedColorHash||card.pairedSheetHash}</code>}</details>
 </article>;
}

function localizedReferenceRole(role:string,locale:Locale){
 const ru=locale==='ru',view=role.match(/\b(front|back|left|right|side|top)\b/i)?.[1]?.toLowerCase(),viewName=view?(ru?({front:'спереди',back:'сзади',left:'слева',right:'справа',side:'сбоку',top:'сверху'} as Record<string,string>)[view]:({front:'Front',back:'Back',left:'Left',right:'Right',side:'Side',top:'Top'} as Record<string,string>)[view]):'';
 if(/depth style/i.test(role))return ru?'Образец стиля карты глубины':'Depth style example';
 if(/shared color sheet/i.test(role))return ru?'Принятый общий цветной лист':'Accepted shared color sheet';
 if(/accepted color/i.test(role))return ru?`Принятый цветной вид ${viewName}`:`Accepted ${viewName.toLowerCase()} color view`;
 if(/registered source artwork|original-source-art/i.test(role))return ru?'Исходный арт':'Original source artwork';
 if(/item source artwork/i.test(role))return ru?'Исходное изображение детали':'Item source artwork';
 if(/mesh-projection-guide|mesh projection guide/i.test(role))return ru?'Гайд проекции сетки':'Mesh projection guide';
 if(/foliage/i.test(role))return ru?'Исходный референс листвы':'Foliage source reference';
 return ru?'Изображение-референс':'Reference image';
}
