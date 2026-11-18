import {describe,expect,it} from 'vitest';
import {productionNoticeCopy} from '../shared/production-notices';
import {productionResultForCommand} from './production-results';

describe('production completion notifications',()=>{
 it('announces only saved images from a mixed-validity guided batch and skips receipt replays',()=>{
  const slots=[{id:'view',purpose:'views'},{id:'depth',purpose:'depth'}];
  const items=[{slotId:'view',candidateId:'saved',reviewStatus:'pending'},{slotId:'depth',candidateId:'invalid',reviewStatus:'invalidated'}];
  const args={id:'character'};
  const accepted=productionResultForCommand('guided_output_batch_submit',args,{slots,batch:{items,workflowId:'workflow'}});
  expect(accepted).toEqual({ownerKind:'character',ownerId:'character',kind:'images',resultId:'saved',count:1});
  expect(productionResultForCommand('guided_output_batch_submit',args,{slots,batch:{items}})).toBeUndefined();
  expect(productionResultForCommand('guided_output_submit',args,{slots,submission:items[1]})).toBeUndefined();
 });
 it('reflects typed model and catalog submissions and omits a duplicate or a read-only command',()=>{
  expect(productionResultForCommand('asset_job_shared_submit',{id:'asset'},{source:{id:'model'},duplicate:true})).toBeUndefined();
  expect(productionResultForCommand('asset_job_return_submit',{id:'asset'},{candidateIds:['model']})).toMatchObject({kind:'results',count:1});
  expect(productionResultForCommand('asset_job_validate',{id:'asset'},{candidateId:'model'})).toBeUndefined();
  const catalog={workflow:{id:'workflow',revision:5},items:[{name:'Door'},{name:'Frame'}]};
  expect(productionResultForCommand('asset_job_catalog_submit',{id:'asset'},catalog)).toMatchObject({kind:'catalog',resultId:'workflow:5',count:2});
 });
 it('shows actual result counts and localized text without claiming a full generation',()=>{
  const result={ownerKind:'assetJob',ownerId:'asset',kind:'images',resultId:'batch',count:2} as const;
  expect(productionNoticeCopy(result,'Cottage','en')).toEqual({title:'Images saved',subject:'Cottage',detail:'Saved for review: 2',message:'Cottage · Saved for review: 2'});
  const longName='Ш'.repeat(240);
  expect(productionNoticeCopy(result,longName,'ru')).toEqual({title:'Изображения сохранены',subject:longName,detail:'Сохранено для проверки: 2',message:`${longName} · Сохранено для проверки: 2`});
 });
});
