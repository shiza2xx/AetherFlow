export function textureExtractionFailureMessage(message:string,locale:'en'|'ru'){
 const managedBudget=/managed conversion working-set limit|blender_memory_budget|managed memory budget/i.test(message);
 if(managedBudget)return locale==='ru'
  ?'Извлечение остановлено: вспомогательный процесс Blender превысил внутренний лимит памяти 1,5 ГиБ. Исходник и сохранённые отметки не изменены. Передайте технические подробности в поддержку.'
  :'Texture extraction stopped because the Blender helper exceeded Atelier’s 1.5 GiB safety limit. Your source and saved marks are unchanged. Include the technical details when requesting support.';
 const allocationFailure=/memoryerror|out of memory|not enough memory|memory allocation failed|cannot allocate memory|не удалось выделить память|недостаточно памяти/i.test(message);
 if(allocationFailure)return locale==='ru'
  ?'Blender не смог выделить память для извлечения текстур. Исходник и сохранённые отметки не изменены. Освободите системную память и повторите попытку.'
  :'Blender could not allocate enough system memory to extract textures. Your source and saved marks are unchanged. Free system memory and try again.';
 if(/Blender process ended|Blender helper produced no report/i.test(message))return locale==='ru'
  ?'Blender остановился до завершения извлечения текстур. Исходник и сохранённые отметки не изменены. Повторите попытку; техническая причина доступна в подробностях.'
  :'Blender stopped before texture extraction finished. Your source and saved marks are unchanged. Retry, or inspect the technical details for the cause.';
 if(/(?:Blender audit exceeded its time budget while waiting for the single-worker slot|Blender operation exceeded its \d+ ms budget while waiting for the single-worker slot)/i.test(message))return locale==='ru'
  ?'Извлечение текстур не дождалось свободного места в очереди Blender. Исходник и сохранённые отметки не изменены. Повторите попытку, когда очередь освободится.'
  :'Texture extraction timed out while waiting for the Blender worker slot. Your source and saved marks are unchanged. Retry when the worker is available.';
 if(/Blender operation exceeded \d+ ms\.?|BLENDER_TIMEOUT/i.test(message))return locale==='ru'
  ?'Извлечение текстур превысило лимит времени. Исходник и сохранённые отметки не изменены. Повторите попытку позже.'
  :'Texture extraction exceeded its time limit. Your source and saved marks are unchanged. Try again later.';
 return null;
}
