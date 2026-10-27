import {Check,FileCheck2,Info} from 'lucide-react';
import type {Locale} from '../shared/i18n';
import './journeyStepGuide.css';

/** Explain the saved mapping report without treating it as human approval. */
export default function JourneySurfaceReport({text,locale}:{text:string;locale:Locale}){
 const ru=locale==='ru',t=(en:string,rus:string)=>ru?rus:en;
 let report:any;try{report=JSON.parse(text);}catch{return <div className="journey-surface-report" role="status">{text}</div>;}
 const proved=report?.geometryCorrespondenceProven===true,finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n),number=(n:number)=>new Intl.NumberFormat(ru?'ru-RU':'en-US').format(n);
 return <article className="journey-surface-report" data-testid="surface-report-summary">
  <header><FileCheck2 size={24}/><div><h3>{t('Surface correspondence','Соответствие поверхностей')}</h3><p>{proved?t('Geometry matching completed','Сопоставление геометрии выполнено'):t('No successful geometry proof in this report','В отчёте нет подтверждения успешного сопоставления')}</p></div></header>
  <p>{t('AetherFlow checks that the textured groups belong to the saved character mesh. Their UVs and materials can then be transferred onto that geometry.','AetherFlow проверяет, что текстурированные группы соответствуют сохранённой сетке персонажа. После этого их UV и материалы можно перенести на эту геометрию.')}</p>
  <dl>{finite(report?.mappedFaceCount)&&<div><dt>{t('Matched faces','Сопоставлено граней')}</dt><dd>{number(report.mappedFaceCount)}</dd></div>}{finite(report?.maxPositionError)&&<div><dt>{t('Maximum position difference','Максимальное отклонение координат')}</dt><dd>{report.maxPositionError.toExponential(3)}</dd></div>}{finite(report?.tolerance)&&<div><dt>{t('Allowed numerical difference','Допуск численной погрешности')}</dt><dd>{report.tolerance.toExponential(3)}</dd></div>}</dl>
  <ul>{proved&&<li><Check size={15}/>{t('The report confirms complete geometry correspondence.','Отчёт подтверждает полное соответствие геометрии.')}</li>}{report?.rigWeightsActionsPreserved===true&&<li><Check size={15}/>{t('Existing rig, weight and animation data were preserved.','Существующие данные рига, весов и анимаций сохранены.')}</li>}{finite(report?.maxPositionError)&&finite(report?.tolerance)&&report.maxPositionError<=report.tolerance&&<li><Check size={15}/>{t('Measured coordinate differences are within the declared tolerance. Values use model coordinates.','Измеренные расхождения координат находятся в пределах указанного допуска. Значения приведены в координатах модели.')}</li>}</ul>
  <p className="journey-surface-review-note"><Info size={16}/>{t('This is a technical check, not your approval. Inspect the assembled model and its textures, then accept the successful result using the review controls.','Это техническая проверка, а не ваше подтверждение. Осмотрите собранную модель и её текстуры, затем примите удачный результат кнопками проверки.')}</p>
  <details><summary>{t('Technical report','Технический отчёт')}</summary><pre>{text}</pre></details>
 </article>;
}
