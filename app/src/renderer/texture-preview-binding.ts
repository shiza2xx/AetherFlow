export type VerifiedTextureBinding={meshName:string;materialName:string;materialSlot:number;imageNodeName:string;imageName?:string;uvSet:string;uvIndex:number;uvDigest:string;displayUvSignature:string};
export type TexturePreviewProof={materials?:Array<{material:string;maps?:{baseColor?:{image:string;width:number;height:number;decodedPixelHash:string;decoded?:boolean}|null}}>;uv?:Array<{object:string;layers?:string[]}>};
export type TexturePreviewBindingCheck={binding:VerifiedTextureBinding;meshName:string;materialName:string;materialSlot:number;imageName:string;expectedImageName:string;uvAttributePresent:boolean;uvSignature:string;previewId:string;previewHash:string;sourceHash:string;expectedPreviewId:string;expectedPreviewHash:string;expectedSourceHash:string;previewProof?:TexturePreviewProof;imageWidth:number;imageHeight:number;decodedPixelHash:string};
export const TEXTURE_PREVIEW_BINDING_ERROR_PREFIX='TEXTURE_PREVIEW_BINDING_FAILURE:';

export function formatTexturePreviewBindingError(reason:string,sources:string,previews:string){
 return TEXTURE_PREVIEW_BINDING_ERROR_PREFIX+JSON.stringify({reason,sources,previews});
}

export function texturePreviewBindingErrorMessage(error:string,locale:'en'|'ru'){
 if(!error.startsWith(TEXTURE_PREVIEW_BINDING_ERROR_PREFIX))return null;
 return locale==='ru'
  ?'Не удалось подтвердить соответствие текстур исходной модели предпросмотру. Откройте «Технические сведения», чтобы увидеть причину проверки и данные сравнения.'
  :'The preview could not be matched to the source textures. Open Technical details to see the failed check and comparison data.';
}

export function texturePreviewBindingFailure(input:TexturePreviewBindingCheck):string|null{
 const b=input.binding;
 if(input.meshName!==b.meshName||input.materialName!==b.materialName||input.materialSlot!==b.materialSlot)return 'The displayed mesh, material, or slot does not match the verified source binding.';
 if(input.imageName!==input.expectedImageName)return 'The displayed base-color image name does not match the verified source image.';
 if(!input.uvAttributePresent)return `The displayed model does not contain the verified ${b.uvSet} UV channel.`;
 if(!b.uvDigest||!b.imageNodeName||input.uvSignature!==b.displayUvSignature)return 'The displayed UV coordinates do not match the verified Blender source.';
 if(input.previewId!==input.expectedPreviewId||input.previewHash!==input.expectedPreviewHash||input.sourceHash!==input.expectedSourceHash)return 'The displayed preview identity or source hash does not match the extracted texture targets.';
 const material=input.previewProof?.materials?.find(row=>row.material===b.materialName),image=material?.maps?.baseColor,uv=input.previewProof?.uv?.find(row=>row.object===b.meshName);
 if(!image)return 'This GLB version has no verified material image proof; choose the matching verified preview version.';
 if(image.image!==input.imageName||image.width!==input.imageWidth||image.height!==input.imageHeight||image.decodedPixelHash!==input.decodedPixelHash||image.decoded!==true)return 'The verified GLB image proof does not match the extracted source image dimensions and pixels.';
 if(!uv?.layers?.includes(b.uvSet))return `The verified GLB preview does not prove the ${b.uvSet} channel for ${b.meshName}.`;
 return null;
}

export function localizeTexturePreviewBindingFailure(message:string,locale:'en'|'ru'){
 if(locale==='en')return message;
 if(message.startsWith('The displayed mesh, material, or slot'))return 'Сетка, материал или слот предпросмотра не совпадает с подтверждённой привязкой исходника.';
 if(message.startsWith('The displayed base-color image name'))return 'Имя изображения базового цвета в предпросмотре не совпадает с подтверждённым изображением исходника.';
 if(message.startsWith('The displayed model does not contain'))return 'В выбранной версии модели отсутствует подтверждённый UV-канал.';
 if(message.startsWith('The displayed UV coordinates'))return 'UV-координаты предпросмотра не совпадают с проверенным исходником Blender.';
 if(message.startsWith('The displayed preview identity'))return 'Хэш версии предпросмотра или исходника изменился; перезагрузите модель.';
 if(message.startsWith('This GLB version has no verified material image proof'))return 'У этой версии GLB нет проверки привязки текстур. Выберите соответствующий проверенный предпросмотр.';
 if(message.startsWith('The verified GLB image proof'))return 'Проверка изображения GLB не совпадает с размером или пикселями извлечённой текстуры исходника.';
 if(message.startsWith('The verified GLB preview does not prove'))return 'Проверенный предпросмотр GLB не подтверждает нужную UV-развёртку этой сетки.';
 return message;
}
