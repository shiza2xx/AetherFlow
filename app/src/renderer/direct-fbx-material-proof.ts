import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

export type ManagedModelUrl={id:string;hash?:string;name:string;url:string;versionOf?:string|null;sourceInputHash?:string|null;parentId?:string|null;dependencies:Array<{logicalPath:string;hash:string;role:string}>};

function safeManagedDependencyUrl(base:URL,id:string,requested:string,dependencies:ManagedModelUrl['dependencies']):string{
 const url=new URL(requested,base);
 if(url.protocol==='data:'||url.protocol==='blob:')return requested;
 if(url.protocol!==base.protocol||url.host!==base.host)throw new Error(`FBX texture request escaped the managed artifact: ${requested}`);
 const prefix=`/${id}/`;
 if(!url.pathname.startsWith(prefix))throw new Error(`FBX texture request is outside its managed artifact: ${requested}`);
 const logicalPath=decodeURIComponent(url.pathname.slice(prefix.length)).replace(/\\/g,'/');
 if(!logicalPath)return base.href;
 if(logicalPath.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error(`FBX texture request has an unsafe path: ${requested}`);
 const dependency=dependencies.find(value=>value.logicalPath===logicalPath);
 if(!dependency)throw new Error(`FBX texture request has no exact managed dependency: ${logicalPath}`);
 return `${base.origin}/${id}/${dependency.logicalPath.split('/').map(encodeURIComponent).join('/')}`;
}

function waitForManagedAssets(manager:THREE.LoadingManager,errors:string[],timeoutMs=45000){
 return new Promise<void>((resolve,reject)=>{
  let settled=false;const timer=window.setTimeout(()=>{if(!settled){settled=true;reject(new Error('Timed out while loading the direct FBX texture dependencies.'));}},timeoutMs);
  manager.onLoad=()=>{if(settled)return;settled=true;window.clearTimeout(timer);resolve();};
  manager.onError=url=>{errors.push(String(url));};
 });
}

export async function loadManagedDirectFbx(data:ManagedModelUrl){
 const manager=new THREE.LoadingManager(),errors:string[]=[],base=new URL(data.url);
 manager.setURLModifier(url=>safeManagedDependencyUrl(base,data.id,url,data.dependencies));
 const complete=waitForManagedAssets(manager,errors),rootPromise=new FBXLoader(manager).loadAsync(data.url);
 const [root]=await Promise.all([rootPromise,complete]);
 return {root,errors};
}

async function loadProxyGlb(data:ManagedModelUrl){
 const manager=new THREE.LoadingManager(),errors:string[]=[];
 manager.setURLModifier(url=>safeManagedDependencyUrl(new URL(data.url),data.id,url,data.dependencies));
 const complete=waitForManagedAssets(manager,errors),loader=new GLTFLoader(manager);loader.setMeshoptDecoder(MeshoptDecoder);
 const [gltf]=await Promise.all([loader.loadAsync(data.url),complete]);
 return {root:gltf.scene,errors};
}

function textureInfo(texture:THREE.Texture|null|undefined){
 if(!texture)return null;
 const image=texture.image as HTMLImageElement|ImageBitmap|HTMLCanvasElement|undefined;
 let sample:{width:number;height:number;rgba:number[]}|null=null;
 try{if(image){const width=image.width||0,height=image.height||0;if(width&&height){const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;const context=canvas.getContext('2d',{willReadFrequently:true});if(context){context.drawImage(image as CanvasImageSource,0,0,4,4);sample={width,height,rgba:Array.from(context.getImageData(1,1,1,1).data)};}}}}catch{/* A blocked or unreadable image stays visible as an unverified channel. */}
 return {name:texture.name||null,uuid:texture.uuid,colorSpace:texture.colorSpace,width:image?.width||0,height:image?.height||0,sourceUrl:image instanceof HTMLImageElement?image.currentSrc||image.src:null,sample};
}

export function summarizeModelMaterials(root:THREE.Object3D){
 const meshes:Array<{name:string;material:string;materialType:string;channels:Record<string,ReturnType<typeof textureInfo>>;roughness:number|null;metalness:number|null;skinned:boolean}> = [];
 root.traverse((object:any)=>{if(!object.isMesh)return;for(const material of Array.isArray(object.material)?object.material:[object.material]){if(!material)continue;const standard=material as THREE.MeshStandardMaterial;meshes.push({name:String(object.name||''),material:String(material.name||''),materialType:String(material.type),channels:{baseColor:textureInfo(standard.map),normal:textureInfo(standard.normalMap),roughness:textureInfo(standard.roughnessMap),metallic:textureInfo(standard.metalnessMap)},roughness:Number.isFinite(standard.roughness)?standard.roughness:null,metalness:Number.isFinite(standard.metalness)?standard.metalness:null,skinned:object.isSkinnedMesh===true});}});
 return meshes;
}

async function renderAppearance(root:THREE.Object3D){
 const width=384,height=384,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#20242b');scene.add(new THREE.HemisphereLight(0xffffff,0x777777,1.6));const key=new THREE.DirectionalLight(0xffffff,3.1);key.position.set(3,6,4);scene.add(key);const fill=new THREE.DirectionalLight(0xffffff,1.3);fill.position.set(-5,2,-4);scene.add(fill);scene.add(root);root.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(root),sphere=bounds.getBoundingSphere(new THREE.Sphere());if(!Number.isFinite(sphere.radius)||sphere.radius<=0){renderer.dispose();throw new Error('Direct FBX comparison has no finite model bounds.');}
 const camera=new THREE.PerspectiveCamera(35,1,.01,10000);camera.position.copy(sphere.center).add(new THREE.Vector3(0,sphere.radius*.28,sphere.radius*3.6));camera.lookAt(sphere.center);camera.near=Math.max(.001,sphere.radius*.001);camera.far=sphere.radius*12;camera.updateProjectionMatrix();
 const compileStarted=performance.now();await renderer.compileAsync(scene,camera).catch(()=>{});renderer.render(scene,camera);await new Promise<void>(resolve=>requestAnimationFrame(()=>{renderer.render(scene,camera);resolve();}));
 const dataUrl=canvas.toDataURL('image/png'),image=new Image();image.src=dataUrl;await image.decode();const pixels=document.createElement('canvas');pixels.width=width;pixels.height=height;const context=pixels.getContext('2d',{willReadFrequently:true})!;context.drawImage(image,0,0);const rgba=context.getImageData(0,0,width,height).data;
 renderer.dispose();scene.remove(root);return {width,height,dataUrl,rgba:Array.from(rgba),compileAndFrameMs:performance.now()-compileStarted};
}

function comparePixels(a:number[],b:number[]){if(a.length!==b.length)throw new Error('Rendered preview dimensions do not match.');let total=0,max=0,changedPixels=0;for(let index=0;index<a.length;index+=4){let changed=false;for(let channel=0;channel<4;channel++){const delta=Math.abs(a[index+channel]-b[index+channel]);total+=delta;max=Math.max(max,delta);if(channel<3&&delta>16)changed=true;}if(changed)changedPixels++;}return {channels:a.length,meanAbsoluteDelta:total/a.length,maxDelta:max,pixelsChangedOver16:changedPixels};}

function disposeLoaded(root:THREE.Object3D){root.traverse((object:any)=>{object.geometry?.dispose?.();for(const material of Array.isArray(object.material)?object.material:[object.material]){if(!material)continue;for(const value of Object.values(material) as any[])if(value?.isTexture)value.dispose();material.dispose?.();}});}

/** Explicit QA diagnostic only. The normal viewer never invokes this direct-vs-proxy comparison. */
export async function compareDirectFbxToProxy(source:ManagedModelUrl,proxy:ManagedModelUrl){
 if(pathExt(source.name)!=='fbx'||pathExt(proxy.name)!=='glb'||proxy.versionOf!==source.id||proxy.sourceInputHash!==source.hash||proxy.parentId!==source.parentId)throw new Error('Direct FBX comparison requires the exact managed GLB proxy derived from the same source and owner.');
 const started=performance.now();let direct:Awaited<ReturnType<typeof loadManagedDirectFbx>>|undefined,glb:Awaited<ReturnType<typeof loadProxyGlb>>|undefined;
 try{
  const directStarted=performance.now();direct=await loadManagedDirectFbx(source);const directFrame=await renderAppearance(direct.root),directFirstFrameMs=performance.now()-directStarted,proxyStarted=performance.now();
  glb=await loadProxyGlb(proxy);const proxyFrame=await renderAppearance(glb.root),proxyFirstFrameMs=performance.now()-proxyStarted;
  const directMaterials=summarizeModelMaterials(direct.root),proxyMaterials=summarizeModelMaterials(glb.root),hasSkinnedMeshes=directMaterials.some(value=>value.skinned);
  return {schemaVersion:1,source:{id:source.id,name:source.name},proxy:{id:proxy.id,name:proxy.name},elapsedMs:performance.now()-started,directFbx:{materials:directMaterials,loadErrors:direct.errors,skinWeights:'FBXLoader truncates to four influences per vertex',firstRenderedFrameMs:directFirstFrameMs,shaderCompileAndFrameMs:directFrame.compileAndFrameMs},glbProxy:{materials:proxyMaterials,loadErrors:glb.errors,skinWeights:'Application GLB decoder preserves up to eight influences',firstRenderedFrameMs:proxyFirstFrameMs,shaderCompileAndFrameMs:proxyFrame.compileAndFrameMs},appearance:{directImage:directFrame.dataUrl,proxyImage:proxyFrame.dataUrl,...comparePixels(directFrame.rgba,proxyFrame.rgba)},hasSkinnedMeshes};
 }finally{if(direct)disposeLoaded(direct.root);if(glb)disposeLoaded(glb.root);}
}

function pathExt(name:string){return name.split('.').pop()?.toLowerCase()||'';}
