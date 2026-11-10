import React from 'react';
import type {ImageGenerationMode} from '../shared/asset-production';
import './imageGenerationMode.css';

type Props={value:ImageGenerationMode;locale:'en'|'ru';disabled?:boolean;onChange:(value:ImageGenerationMode)=>void;label?:string};

export default function ImageGenerationModeSelector({value,locale,disabled=false,onChange,label}:Props){
 const ru=locale==='ru',title=label||(ru?'Способ получения изображений':'Image generation mode');
 return <fieldset className="image-generation-mode" aria-label={title} disabled={disabled}>
  <legend>{title}</legend>
  <div role="group" aria-label={title}>
   <button type="button" aria-pressed={value==='codex'} className={value==='codex'?'selected':''} onClick={()=>onChange('codex')}>{ru?'Codex':'Codex'}</button>
   <button type="button" aria-pressed={value==='manual'} className={value==='manual'?'selected':''} onClick={()=>onChange('manual')}>{ru?'Вручную':'Manual'}</button>
  </div>
  <small role="status">{value==='manual'?(ru?'Ручной режим: Codex подготовит текстовые промпты, изображения добавляются вручную.':'Manual mode: Codex prepares text prompts; you add the images yourself.'):(ru?'Режим Codex: обычная генерация изображений доступна в Codex.':'Codex mode: normal image generation runs through Codex.')}</small>
 </fieldset>;
}
