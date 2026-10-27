import {describe,expect,it} from 'vitest';
import {textureExtractionFailureMessage} from './texture-extraction-error';

describe('texture extraction failure guidance',()=>{
 it('distinguishes the enforced worker budget from a real allocation failure',()=>{
  const failure='Blender process exceeded the 1610612736-byte managed conversion working-set limit (1700000000 bytes); no candidate was published.';
  expect(textureExtractionFailureMessage(failure,'en')).toMatch(/1\.5 GiB safety limit.*source and saved marks are unchanged/i);
  expect(textureExtractionFailureMessage(failure,'en')).not.toMatch(/close.*apps/i);
  expect(textureExtractionFailureMessage(failure,'ru')).toMatch(/лимит памяти 1,5 ГиБ.*сохранённые отметки не изменены/i);
  expect(textureExtractionFailureMessage('Blender MemoryError: cannot allocate image pixels','en')).toMatch(/could not allocate enough system memory.*free system memory/i);
  expect(textureExtractionFailureMessage('Blender MemoryError: недостаточно памяти','ru')).toMatch(/не смог выделить память.*Освободите системную память/i);
  expect(textureExtractionFailureMessage('Blender process ended (-1073741819): unknown worker error','ru')).toMatch(/Blender остановился до завершения извлечения/i);
  expect(textureExtractionFailureMessage('Source hash mismatch','en')).toBeNull();
 });
 it('maps both queued timeout forms separately from the execution timeout',()=>{
  for(const message of ['Blender audit exceeded its time budget while waiting for the single-worker slot.','Blender operation exceeded its 180000 ms budget while waiting for the single-worker slot.']){
   expect(textureExtractionFailureMessage(message,'en')).toMatch(/timed out while waiting for the Blender worker slot/i);
   expect(textureExtractionFailureMessage(message,'ru')).toMatch(/не дождалось свободного места в очереди Blender/i);
  }
  expect(textureExtractionFailureMessage('Blender operation exceeded 180000 ms.','en')).toMatch(/exceeded its time limit/i);
 });
});
