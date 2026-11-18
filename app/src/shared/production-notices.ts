import type {Locale} from './i18n';

export type ProductionResult={
 ownerKind:'character'|'assetJob';
 ownerId:string;
 resultId:string;
 kind:'images'|'results'|'catalog'|'reference-plan';
 count:number;
};

export type ProductionNotice=ProductionResult & {
 event:'production.complete';
 key:string;
 workspace:string;
 workspaceInstanceId:string;
 createdAt:number;
 showInApp:boolean;
 title:string;
 subject:string;
 detail:string;
 message:string;
};

export type ReferenceDraftStatus={
 event:'reference-plan.draft-status';
 workspace:string;
 workspaceInstanceId:string;
 ownerKind:ProductionResult['ownerKind'];
 ownerId:string;
 draftId:string;
 status:'waiting'|'invalid'|'imported';
};

export function productionNoticeCopy(result:ProductionResult,name:string,locale:Locale){
 const ru=locale==='ru';
 const title={
  images:ru?'Изображения сохранены':'Images saved',
  results:ru?'Результаты сохранены':'Results saved',
  catalog:ru?'Каталог сохранён':'Catalog saved',
  'reference-plan':ru?'Референсный план готов':'Reference plan ready',
 }[result.kind];
 const detail=result.kind==='reference-plan'?'':ru?`Сохранено для проверки: ${result.count}`:`Saved for review: ${result.count}`;
 const subject=Array.from(name.trim()).slice(0,240).join('');
 return {title,subject,detail,message:[subject,detail].filter(Boolean).join(' · ')};
}
