import {assetValidationCopy,type AssetValidationLocale} from './asset-validation-copy';

export default function AssetValidationMessage({message,locale,severity='issue',className=''}:{message:string;locale:AssetValidationLocale;severity?:'issue'|'warning';className?:string}){
 const copy=assetValidationCopy(message,locale),ru=locale==='ru';
 return <div className={`asset-validation-message asset-validation-${severity} ${className}`.trim()} data-severity={severity}>
  <p>{copy.message}</p>
  {copy.technicalDetails&&<details><summary>{ru?'Технические сведения':'Technical detail'}</summary><code>{copy.technicalDetails}</code></details>}
 </div>;
}
