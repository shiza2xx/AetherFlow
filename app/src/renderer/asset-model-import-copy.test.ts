import {describe,expect,it} from 'vitest';
import {assetModelImportDiagnostic,assetModelImportError,assetModelImportSource,assetModelImportStageLabel,assetModelImportStatusDetail,assetModelImportStatusMessage} from './asset-model-import-copy';

describe('localized asset model import errors',()=>{
 it('explains ZIP model count and unsafe archive contents in both locales',()=>{
  expect(assetModelImportError(new Error('ZIP must contain exactly one FBX, GLB or OBJ model; found 0.'),'en')).toMatch(/exactly one/i);
  expect(assetModelImportError(new Error('ZIP must contain exactly one FBX, GLB or OBJ model; found 2.'),'ru')).toMatch(/ровно одна модель/i);
  expect(assetModelImportError(new Error('ZIP contains an unsafe path or duplicate alias.'),'en')).toMatch(/unsafe or duplicate paths/i);
  expect(assetModelImportError(new Error('ZIP contains an unsafe path or duplicate alias.'),'ru')).toMatch(/небезопасные или повторяющиеся пути/i);
  expect(assetModelImportError(new Error('ZIP links and special file entries are not allowed.'),'ru')).toMatch(/ссылки или специальные файлы/i);
  expect(assetModelImportError(new Error('ZIP expansion limit exceeded.'),'en')).toMatch(/size, file-count or nesting limits/i);
  expect(assetModelImportError(new Error('Required sidecar file is missing: materials/wood.png'),'ru')).toMatch(/отсутствует текстура/i);
  expect(assetModelImportError(Object.assign(new Error('Blender exited with code 4.'),{code:'BLENDER_EXIT'}),'ru')).toMatch(/Не удалось обработать модель/i);
  expect(assetModelImportDiagnostic(Object.assign(new Error('Blender exited with code 4.'),{code:'BLENDER_EXIT'}))).toEqual({detail:'Blender exited with code 4.',code:'BLENDER_EXIT'});
 });
 it('uses the picked local path when available and offers a bounded ZIP-byte fallback for drag-and-drop files',async()=>{
  const file={name:'tripo.zip',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer} as File;
  expect(await assetModelImportSource(file,'D:/fixture/tripo.zip')).toEqual({paths:['D:/fixture/tripo.zip'],files:[]});
  const fallback=await assetModelImportSource(file,'');expect(fallback.paths).toEqual([]);expect(fallback.files[0]).toMatchObject({name:'tripo.zip',bytes:new Uint8Array([1,2,3])});
  await expect(assetModelImportSource({name:'large.zip',size:128*1024*1024+1} as File,'')).rejects.toThrow(/128 MB/i);
  await expect(assetModelImportSource({name:'mesh.obj',size:4,arrayBuffer:async()=>new ArrayBuffer(0)} as File,'')).rejects.toThrow(/file path is unavailable/i);
 });
 it('relocalizes saved import failures and completion copy while preserving raw technical details',()=>{
  const failure={ownerId:'job-a',itemId:'item-a',phase:'material' as const,operationId:'op-a',stage:'registering' as const,itemName:'Shared prop',fileName:'return.zip',state:'error' as const,message:'The model could not be processed. Check the file and its dependencies, then retry the import.',code:'QA_TEXTURE_IMPORT_EIO',detail:'Synthetic textured return failure.\nCaused by: missing texture resource.' ,startedAt:100};
  const complete={...failure,state:'complete' as const,stage:'preview' as const,message:'The preview file is ready. Reopen this item to inspect it.',detail:undefined,code:undefined};
  expect(assetModelImportStatusMessage(failure,'ru')).toMatch(/Не удалось обработать модель/);
  expect(assetModelImportStatusDetail(failure,'ru')).toBe(failure.detail);
  expect(assetModelImportStatusMessage(complete,'ru')).toBe('Файл предпросмотра готов. Снова откройте эту деталь, чтобы проверить модель.');
  expect(failure.message).toBe('The model could not be processed. Check the file and its dependencies, then retry the import.');
  expect(failure.detail).toContain('Caused by: missing texture resource.');
 });
 it('uses terminal labels for finished imports and keeps registering copy only while active',()=>{
  const importing={ownerId:'job-a',itemId:'item-a',phase:'material' as const,operationId:'op-a',stage:'registering' as const,itemName:'Shared prop',fileName:'return.zip',state:'importing' as const,message:'Checking and registering the model…',startedAt:100},failed={...importing,state:'error' as const,detail:'Missing texture dependency: wood/albedo.png.',code:'QA_TEXTURE_IMPORT_EIO'},complete={...importing,state:'complete' as const};
  expect(assetModelImportStageLabel(importing,'en')).toBe('Checking and registering file');
  expect(assetModelImportStageLabel(importing,'ru')).toBe('Проверяем и регистрируем файл');
  expect(assetModelImportStageLabel(failed,'en')).toBe('Import failed');
  expect(assetModelImportStageLabel(failed,'ru')).toBe('Ошибка импорта');
  expect(assetModelImportStageLabel(failed,'ru')).not.toMatch(/проверяем|регистрируем/i);
  expect(assetModelImportStageLabel(complete,'en')).toBe('Import complete');
  expect(assetModelImportStageLabel(complete,'ru')).toBe('Импорт завершён');
  expect(assetModelImportStatusDetail(failed,'en')).toBe(failed.detail);
  expect(assetModelImportStatusDetail(failed,'ru')).toBe(failed.detail);
 });
 it('keeps the unknown outcome of an interrupted import explicit after changing locale',()=>{
  const interrupted={ownerId:'job-a',itemId:'item-a',phase:'material' as const,operationId:'op-a',stage:'registering' as const,itemName:'Shared prop',fileName:'return.zip',state:'error' as const,message:'The window refreshed before this operation was confirmed. The item must be checked before retrying.',code:'IMPORT_INTERRUPTED',detail:'Source registration may have completed; no automatic submission was performed.',startedAt:100};
  expect(assetModelImportStatusMessage(interrupted,'ru')).toMatch(/окно обновилось до подтверждения результата/i);
  expect(assetModelImportStatusDetail(interrupted,'ru')).toMatch(/автоматическая отправка не выполнялась/i);
  expect(interrupted.detail).toBe('Source registration may have completed; no automatic submission was performed.');
 });
});
