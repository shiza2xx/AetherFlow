export type WrapMode='repeat'|'clamp'|'mirror';
export type UvTransform={matrix?:readonly number[];flipY?:boolean;wrapS?:WrapMode;wrapT?:WrapMode};
export type MarkPoint={u:number;v:number};
export type TextureContentRect={left:number;top:number;width:number;height:number};
/** Texture.transformUv already includes matrix, sampler wrapping and flipY; its output is the top-left image sample coordinate. */
export function transformedTextureUvToImagePoint(uv:{x:number;y:number}):MarkPoint{
 if(!Number.isFinite(uv.x)||!Number.isFinite(uv.y))throw new Error('Transformed texture UV coordinates must be finite.');
 return {u:Math.min(1,Math.max(0,uv.x)),v:Math.min(1,Math.max(0,uv.y))};
}
/** Reapply only user-authored strokes onto freshly extracted, source-verified target metadata. */
export function mergeSavedMarkupStrokes<T extends {key:string;strokes?:unknown}>(fresh:readonly T[],saved:readonly {key:string;strokes?:unknown}[]):Array<T&{strokes:unknown[]}>{const byKey=new Map(saved.map(target=>[target.key,target.strokes]));return fresh.map(target=>{const restored=byKey.get(target.key),alreadyPresent=target.strokes;if(byKey.has(target.key)&&restored!==undefined&&!Array.isArray(restored))throw new Error('A saved texture target contains malformed strokes and was not applied.');if(alreadyPresent!==undefined&&!Array.isArray(alreadyPresent))throw new Error('A fresh texture target contains malformed strokes and was not applied.');return {...target,strokes:restored!==undefined?restored as unknown[]:Array.isArray(alreadyPresent)?alreadyPresent:[]};});}
/** Stable proof of the UV coordinate set emitted by the trusted Blender GLB derivative. */
export function displayUvSignature(values:ArrayLike<number>,positions?:ArrayLike<number>):string{
 if(values.length%2!==0||values.length>10_000_000||positions&&(positions.length%3!==0||positions.length/3!==values.length/2))throw new Error('Displayed UV channel or position correspondence is malformed or exceeds its bound.');
 const q6=(value:number)=>{const scaled=Math.floor(value*1_000_000+0.5),magnitude=Math.abs(scaled);return `${scaled<0?'-':''}${Math.floor(magnitude/1_000_000)}.${String(magnitude%1_000_000).padStart(6,'0')}`;};
 const pairs=new Set<string>();for(let i=0;i<values.length;i+=2){const u=Number(values[i]),v=Number(values[i+1]);if(!Number.isFinite(u)||!Number.isFinite(v))throw new Error('Displayed UV channel contains a non-finite value.');if(positions){const x=Number(positions[i/2*3]),y=Number(positions[i/2*3+1]),z=Number(positions[i/2*3+2]);if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))throw new Error('Displayed vertex positions contain a non-finite value.');pairs.add(`${q6(x)},${q6(y)},${q6(z)}|${q6(u)},${q6(v)}`);}else pairs.add(`${q6(u)},${q6(v)}`);}
 let hash=2166136261;for(const byte of new TextEncoder().encode([...pairs].sort().join(';'))){hash=Math.imul(hash^byte,16777619)>>>0;}return hash.toString(16).padStart(8,'0');
}
export function gltfUvAttributeName(index:number){if(!Number.isInteger(index)||index<0||index>7)throw new Error('GLTF texture coordinate set is outside the supported range.');return index===0?'uv':`uv${index}`;}
export type TextureRepairAttachment={path:string;hash:string;role?:string;group?:string};
/** Resolve only explicit original color inputs and accepted current color/group-paint outputs. */
export function selectTextureRepairReferenceRoles(generationReferenceIds:readonly string[],slots:readonly any[],bindings:readonly {meshName?:string;materialName?:string}[]=[],sourceArtifactIds:readonly string[]=[]){
 const rows=new Map<string,{artifactId:string;role:string;group?:string}>();
 for(const artifactId of [...generationReferenceIds,...sourceArtifactIds])if(typeof artifactId==='string'&&artifactId)rows.set(artifactId,{artifactId,role:'original character-generation color reference'});
 const surfaceNames=bindings.map(binding=>`${binding.meshName||''} ${binding.materialName||''}`.toLowerCase().replace(/[^a-z0-9]+/g,''));
 for(const slot of slots){if(slot?.reviewStatus!=='accepted'||slot.operativeStale===true)continue;const artifactId=String(slot.operativeArtifactId||slot.artifactId||'');if(!artifactId)continue;
  if(slot.purpose==='views'){rows.set(artifactId,{artifactId,role:'accepted color view'});continue;}
  if(slot.purpose==='texture-references'&&typeof slot.group==='string'){const group=slot.group.toLowerCase().replace(/[^a-z0-9]+/g,'');if(group&&surfaceNames.some(name=>name.includes(group)))rows.set(artifactId,{artifactId,role:'accepted group paint reference',group:slot.group});}
 }
 return [...rows.values()];
}
export type MarkStroke={mode:'paint'|'erase';radiusPx:number;points:MarkPoint[]};
export const MAX_MARK_PIXELS=16_777_216;
export const MAX_MARK_STROKES=256;
export const MAX_MARK_POINTS=32_768;
export function textureRepairRequestNote(input:{locale:'en'|'ru';operationId:string;draftHash:string;sourceHash:string;manifestPath:string;attachments:TextureRepairAttachment[];description?:string;referenceDiagnostics?:string[]}){
 const ru=input.locale==='ru',refs=input.attachments.map(row=>`- ${row.role?`[${row.role}${row.group?` · ${row.group}`:''}] `:''}${row.path} (SHA-256 ${row.hash})`).join('\n')+(input.referenceDiagnostics?.length?`\n${ru?'Диагностика цветовых референсов':'Color-reference diagnostics'}:\n${input.referenceDiagnostics.map(item=>`- ${item}`).join('\n')}\n`:'');
 return ru?`Разметка дефектов текстуры: операция ${input.operationId}; хэш черновика ${input.draftHash}; исходник SHA-256 ${input.sourceHash}.\nПрочитай неизменяемый манифест ${input.manifestPath} и все перечисленные вложения:\n${refs}\nОписание дефекта: ${input.description?.trim()||'Не указано.'}\nСначала проверь привязку, материал и UV и установи, какие каналы действительно повреждены. Используй именно закреплённые исходные цветовые референсы генерации персонажа, принятые цветовые ракурсы и принятые красящие референсы выбранных групп; не используй карты глубины или посторонние изображения. До изменений создай контрольную точку рабочей копии. Красная отметка и белая маска задают одну область поверхности и для альбедо, и для диагностики нормалей: построй внутреннюю маску каждого подтверждённого канала по проверенной UV-привязке с учётом размера карты, без повторного выбора области пользователем. Для альбедо нужен пространственный, узорный патч через фактически доступный инструмент генерации изображений, закреплённый на тех же цветовых референсах, исходнике и маске. Не заменяй узор сплошной заливкой. Если инструмент генерации недоступен, укажи требуемую возможность imagegen и оставь задачу ожидающей продолжения; не выдавай фиктивный результат. Совмести сгенерированный патч только внутри маски детерминированным композитором с мягким внутренним краем; точно сохрани исходные пиксели вне маски. Нормали не генерируй как обычное RGB-изображение: исправляй только диагностированное повреждение в касательном пространстве с декодированием векторов, нормализацией и обратным кодированием. Не меняй здоровые карты. Сохрани геометрию, UV, риг и другие каналы, проверь рабочую копию и подготовь отдельный кандидат для принятия человеком.`:`Texture issue markup: operation ${input.operationId}; draft hash ${input.draftHash}; editable source SHA-256 ${input.sourceHash}.\nRead the immutable manifest at ${input.manifestPath} and every listed attachment:\n${refs}\nIssue description: ${input.description?.trim()||'Not provided.'}\nVerify bindings, material assignment and UVs first, then identify which channels are actually damaged. Use exactly the pinned original character-generation color references, accepted color views, and accepted paint references for the affected groups; exclude depth maps and unrelated images. Create a workbench checkpoint before changes. The red locator and white mask define one surface region for both albedo repair and normal diagnosis: derive an internal mask for each confirmed channel from the verified UV binding, accounting for map resolution without asking the user to select the region again. Albedo repair requires a spatial patterned patch through the actually available image-generation tool, anchored to those same color references, the original texture and the mask. Do not substitute a flat fill for a pattern. If image generation is unavailable, report the required imagegen capability and leave a resumable pending task; do not claim a result. Composite the generated patch deterministically only inside the mask with a soft inner edge and preserve exact decoded source pixels outside it. Never generate normal maps as ordinary RGB artwork: only repair a diagnosed defect in tangent space with vector decode, normalization and re-encoding. Leave healthy maps untouched. Preserve geometry, UVs, rig and other channels, validate a checkpointed copy and prepare a separate candidate for human adoption.`;
}

/** Maps a CSS pointer through the actual letterboxed image rectangle to top-left normalized image coordinates. */
export function pointerToImagePoint(clientX:number,clientY:number,rect:{left:number;top:number;width:number;height:number},imageWidth:number,imageHeight:number):MarkPoint|null{
 if(![clientX,clientY,rect.left,rect.top,rect.width,rect.height,imageWidth,imageHeight].every(Number.isFinite)||rect.width<=0||rect.height<=0||imageWidth<1||imageHeight<1)return null;
 const scale=Math.min(rect.width/imageWidth,rect.height/imageHeight),width=imageWidth*scale,height=imageHeight*scale,left=(rect.width-width)/2,top=(rect.height-height)/2,x=(clientX-rect.left-left)/width,y=(clientY-rect.top-top)/height;
 return x<0||x>1||y<0||y>1?null:{u:x,v:y};
}
/** Stroke radius is authored in the bounded preview's pixels; preserve its relative full-resolution footprint on export. */
export function fullResolutionBrushRadius(radiusPx:number,width:number,height:number){if(!finite(radiusPx)||radiusPx<1||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('Texture brush dimensions are invalid.');return radiusPx*Math.max(width,height)/Math.min(1024,Math.max(width,height));}

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function wrap(v:number,mode:WrapMode='clamp'){
 if(mode==='repeat')return ((v%1)+1)%1;
 if(mode==='mirror'){const n=((v%2)+2)%2;return n<=1?n:2-n;}
 return Math.min(1,Math.max(0,v));
}
/** Applies a verified three.js-style 3x3 UV transform, then the declared sampler wrapping. */
export function mapUvToImage(point:MarkPoint,width:number,height:number,transform:UvTransform={}):{x:number;y:number;u:number;v:number}{
 if(!finite(width)||!finite(height)||width<1||height<1||width*height>MAX_MARK_PIXELS)throw new Error('Texture dimensions are invalid or exceed the markup pixel limit.');
 if(!finite(point.u)||!finite(point.v))throw new Error('UV coordinates must be finite.');
 let u=point.u,v=point.v;
 const m=transform.matrix;
 if(m){if(m.length!==9||m.some(value=>!finite(value)))throw new Error('Texture UV transform must contain nine finite matrix values.');const x=m[0]*u+m[3]*v+m[6],y=m[1]*u+m[4]*v+m[7],w=m[2]*u+m[5]*v+m[8];if(Math.abs(w)<1e-12)throw new Error('Texture UV transform maps to an invalid homogeneous coordinate.');u=x/w;v=y/w;}
 if(transform.flipY)v=1-v;
 u=wrap(u,transform.wrapS||'clamp');v=wrap(v,transform.wrapT||'clamp');
 return {x:Math.min(width-1,Math.floor(u*width)),y:Math.min(height-1,Math.floor((1-v)*height)),u,v};
}
export function splitUvStrokeAtDiscontinuities(points:readonly MarkPoint[],transform:UvTransform={},threshold=.5):MarkPoint[][]{
 if(!Number.isFinite(threshold)||threshold<=0||threshold>1)throw new Error('UV discontinuity threshold is invalid.');
 const mapped=points.map(point=>{if(!finite(point.u)||!finite(point.v))throw new Error('UV coordinates must be finite.');let {u,v}=point;const m=transform.matrix;if(m){if(m.length!==9||m.some(value=>!finite(value)))throw new Error('Texture UV transform is invalid.');const x=m[0]*u+m[3]*v+m[6],y=m[1]*u+m[4]*v+m[7],w=m[2]*u+m[5]*v+m[8];if(!w)throw new Error('Texture UV transform is invalid.');u=x/w;v=y/w;}if(transform.flipY)v=1-v;return {u:wrap(u,transform.wrapS||'clamp'),v:wrap(v,transform.wrapT||'clamp')};});
 const result:MarkPoint[][]=[];for(const point of mapped){const current=result.at(-1),prior=current?.at(-1);if(prior&&Math.hypot(point.u-prior.u,point.v-prior.v)>threshold)result.push([point]);else if(current)current.push(point);else result.push([point]);}return result.filter(part=>part.length>0);
}
/** Renders bounded round strokes into a single-channel annotation mask; white means repair requested. */
export function rasterizeMarkMask(width:number,height:number,strokes:readonly MarkStroke[]):Uint8Array{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>MAX_MARK_PIXELS)throw new Error('Texture dimensions are invalid or exceed the markup pixel limit.');
 if(strokes.length>MAX_MARK_STROKES)throw new Error('Texture markup exceeds the stroke limit.');
 let count=0;for(const stroke of strokes){if(!['paint','erase'].includes(stroke.mode)||!finite(stroke.radiusPx)||stroke.radiusPx<1||stroke.radiusPx>256||!Array.isArray(stroke.points)||stroke.points.length<1)throw new Error('A texture markup stroke is malformed.');count+=stroke.points.length;}if(count>MAX_MARK_POINTS)throw new Error('Texture markup exceeds the point limit.');
 const mask=new Uint8Array(width*height);
 const dab=(cx:number,cy:number,r:number,value:number)=>{const minX=Math.max(0,Math.floor(cx-r)),maxX=Math.min(width-1,Math.ceil(cx+r)),minY=Math.max(0,Math.floor(cy-r)),maxY=Math.min(height-1,Math.ceil(cy+r)),rr=r*r;for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)if((x+.5-cx)**2+(y+.5-cy)**2<=rr)mask[y*width+x]=value;};
 for(const stroke of strokes){const value=stroke.mode==='paint'?255:0,radius=fullResolutionBrushRadius(stroke.radiusPx,width,height),points=stroke.points.map(point=>{if(!finite(point.u)||!finite(point.v)||point.u<0||point.u>1||point.v<0||point.v>1)throw new Error('Markup points must be normalized image coordinates.');return {x:point.u*(width-1),y:point.v*(height-1)};});if(points.length===1){dab(points[0].x,points[0].y,radius/2,value);continue;}for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],distance=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(distance/Math.max(1,radius/3)));for(let n=0;n<=steps;n++){const t=n/steps;dab(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,radius/2,value);}}}
 return mask;
}
