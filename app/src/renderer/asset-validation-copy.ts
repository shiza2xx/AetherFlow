export type AssetValidationLocale='en'|'ru';
export type AssetValidationCopy={message:string;technicalDetails?:string};

const text=(message:string,english:string,russian:string,locale:AssetValidationLocale):AssetValidationCopy=>{
 const localized=locale==='ru'?russian:english;
 return {message:localized,...localized===message?{}:{technicalDetails:message}};
};

const itemIssue=(message:string,suffix:string,english:(item:string)=>string,russian:(item:string)=>string,locale:AssetValidationLocale)=>{
 const marker=`: ${suffix}`;
 if(!message.endsWith(marker))return null;
 const item=message.slice(0,-marker.length);
 if(!item)return null;
 return text(message,english(item),russian(item),locale);
};

/** Translate known asset validator and model-import warnings while keeping the exact raw diagnostic available. */
export function assetValidationCopy(message:string,locale:AssetValidationLocale='en'):AssetValidationCopy{
 if(/Composite placements are missing/i.test(message))return text(message,'Prepare and accept a non-empty placement plan for this composite before generating images. Existing outputs remain available for review, and Stage 5 repair keeps accepted files intact.','Подготовьте и примите план размещения деталей составного объекта до генерации изображений. Существующие результаты останутся доступны для проверки, а исправление на этапе 5 сохранит принятые файлы.',locale);
 if(/Bundled FFmpeg image decoder is unavailable/i.test(message))return text(message,'The bundled image decoder is missing. Repair the application tools and retry batch review, or upload this image as PNG.','В приложении отсутствует встроенный декодер изображений. Восстановите файлы приложения и повторите пакетную проверку либо загрузите изображение в PNG.',locale);
 if(/FFmpeg could not fully decode this image/i.test(message))return text(message,'The JPEG or WebP file could not be fully decoded. Replace it with a complete, non-animated image and retry; no candidate was accepted.','Не удалось полностью декодировать JPEG или WebP. Замените файл полной статичной версией и повторите проверку; кандидат не принят.',locale);
 if(/Animated WebP is not supported/i.test(message))return text(message,'Animated WebP is not supported for asset references. Export a still image and retry.','Анимированный WebP нельзя использовать как референс ассета. Экспортируйте статичное изображение и повторите проверку.',locale);
 if(/Image dimensions exceed the decode limit|compressed size limit|Decoded image exceeds the bounded output limit/i.test(message))return text(message,'This image exceeds the safe batch review limits. Resize or export it as a smaller image, then retry.','Изображение превышает безопасные ограничения пакетной проверки. Уменьшите его и повторите проверку.',locale);
 if(/image container is truncated|JPEG markers are missing or truncated|JPEG segment is truncated|JPEG frame or scan is missing|WebP container length is invalid|WebP chunk is truncated|WebP frame is missing or truncated/i.test(message))return text(message,'The image file is incomplete or malformed. Replace it with a valid PNG, JPEG or WebP, then retry.','Файл изображения неполный или повреждён. Замените его корректным PNG, JPEG или WebP и повторите проверку.',locale);
 const fixed:Record<string,[string,string]>={
  'Catalog has no asset items.':['The catalog has no asset items.','В каталоге нет деталей.'],
  'Catalog requires human acceptance.':['The catalog needs human review and acceptance.','Каталог требует проверки и принятия человеком.'],
  'Composite has no active instances.':['This composite has no saved placements, so scene building is blocked. Prepare a placement repair from the source and accepted models; existing models and files stay intact. Review the proposed placements before accepting them.','У этого составного объекта не сохранены размещения, поэтому сборка сцены заблокирована. Подготовьте размещения по исходнику и принятым моделям; существующие модели и файлы сохранятся. Проверьте размещения перед принятием.'],
  'The accepted scene no longer matches current parts. Rebuild and review the scene before export.':['The accepted scene no longer matches current parts. Rebuild and review it before export.','Принятая сцена больше не соответствует актуальным деталям. Пересоберите её и проверьте перед экспортом.'],
  'Returned geometry differs from its accepted baseline; inspect compatibility before acceptance.':['Returned geometry differs from its accepted baseline; check compatibility before accepting it.','Возвращённая геометрия отличается от принятой исходной версии. Проверьте совместимость перед принятием.'],
  'Returned UV layout differs from its accepted baseline; inspect texture compatibility.':['Returned UV layout differs from its accepted baseline; check texture compatibility.','UV-развёртка возвращённой модели отличается от принятой исходной версии. Проверьте совместимость текстур.'],
  'No accepted geometry baseline was available for compatibility comparison.':['There is no accepted geometry baseline for the compatibility check.','Нет принятой исходной геометрии для проверки совместимости.'],
  'Inspect alpha edges, checkerboard artifacts and all views before acceptance.':['Inspect alpha edges, checkerboard artifacts and every view before acceptance.','Перед принятием проверьте края альфа-канала, шахматные артефакты и все ракурсы.'],
  'Inspect reverse faces and crown appearance before acceptance.':['Inspect reverse faces and the crown appearance before acceptance.','Перед принятием проверьте обратные стороны полигонов и внешний вид кроны.'],
 };
 const direct=fixed[message];if(direct)return text(message,direct[0],direct[1],locale);
 const itemMappings:[string,(item:string)=>string,(item:string)=>string][]=[
  ['current geometry is missing or stale.',item=>'Current geometry is missing or stale for “'+item+'”.',item=>'Для детали «'+item+'» отсутствует актуальная геометрия или она устарела.'],
  ['image inputs require review.',item=>'Image inputs need review for “'+item+'”.',item=>'Изображения детали «'+item+'» требуют проверки.'],
  ['material needs compatibility review.',item=>'The material needs a compatibility review for “'+item+'”.',item=>'Для детали «'+item+'» нужно проверить совместимость материала с геометрией.'],
  ['returned model materials need visual verification.',item=>'Returned model materials need visual verification for “'+item+'”.',item=>'Проверьте внешний вид материалов в возвращённой модели детали «'+item+'».'],
 ];
 for(const [suffix,english,russian] of itemMappings){const found=itemIssue(message,suffix,english,russian,locale);if(found)return found;}
 const corruptDependency=message.match(/^(.+): missing or corrupt dependency (.+)$/);
 if(corruptDependency)return text(message,message,`У детали «${corruptDependency[1]}» отсутствует или повреждён файл зависимости: ${corruptDependency[2]}.`,locale);
 const uv=message.match(/^UV maps are missing on (.+)\.$/);
 if(uv)return text(message,message,`В возвращённой модели отсутствуют UV-развёртки: ${uv[1]}.`,locale);
 const materials=message.match(/^Materials are missing on (.+)\.$/);
 if(materials)return text(message,message,`В возвращённой модели не назначены материалы: ${materials[1]}.`,locale);
 const textures=message.match(/^Texture files are missing: (.+)\.$/);
 if(textures)return text(message,message,`Не найдены файлы текстур: ${textures[1]}.`,locale);
 const landmark=message.match(/^([^:]+): landmark (.+) differs by more than 5% of silhouette height\.$/);
 if(landmark)return text(message,message,`В ракурсе ${landmark[1]} положение ориентира «${landmark[2]}» отличается более чем на 5% высоты силуэта.`,locale);
 return {message};
}
