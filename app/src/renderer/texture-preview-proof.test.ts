import {describe,expect,it} from 'vitest';
import {hasVerifiedTextureBindingProof,preferVerifiedTexturePreviews,preferredTexturePreviewDefault} from './texture-preview-proof';

const sourceId='source-fit',sourceHash='1'.repeat(64),previewHash='2'.repeat(64);
const proof={materials:[
 {material:'tripo_mat_326b51cb',maps:{baseColor:{image:'tail_basecolor',width:4096,height:4096,decodedPixelHash:'6b780b1a3351d01bfa9bc737feea5ce76fc084542491156693efbf1e2499cd03',decoded:true}}},
 {material:'tripo_mat_3436c2a1',maps:{baseColor:{image:'upper_body_basecolor',width:4096,height:4096,decodedPixelHash:'b936ad115ed42a901f7e05ecbd2bee7ba3732075556e2ca9e220c07b4c657642',decoded:true}}},
 {material:'tripo_mat_58408882',maps:{baseColor:{image:'hair_basecolor',width:4096,height:4096,decodedPixelHash:'3325873b6adbb134ccbaf8bdfb9151971313220483711ee3df12ab31c3731573',decoded:true}}},
 {material:'tripo_mat_b143f6d9',maps:{baseColor:{image:'lower_body_basecolor',width:4096,height:4096,decodedPixelHash:'d845e1e2db1eb4af4f264494d095fd18f4153ed4adacf841358e2c3c72b6ad3c',decoded:true}}},
 {material:'tripo_mat_cb92b7f0',maps:{baseColor:{image:'head_basecolor',width:4096,height:4096,decodedPixelHash:'d6506658821f8af4b714abf70b0543c9f2d967a922360f4dcc6ecb260b820449',decoded:true}}},
],uv:['Atelier_accessories','Atelier_hair','Atelier_head','Atelier_lower_body','Atelier_upper_body'].map(object=>({object,layers:['UVMap']}))};
function derivative(id:string,updatedAt:string,withProof:boolean){return {id,updatedAt,data:{sourceName:'preview.glb',hash:previewHash,sourceInputHash:sourceHash,versionOf:sourceId,sourceParentId:sourceId,settings:withProof?{textureBindingProofs:proof}: {materialGraphRecipes:[]},validationChecks:{outputHashVerified:true,sourceUnmodified:true}}};}

describe('verified Blender texture preview selection',()=>{
 it('prefers the proof-bearing exact-source duplicate even when legacy history sorts newer',()=>{
  const legacy=derivative('legacy','2026-10-23T00:00:00Z',false),verified=derivative('verified','2026-10-22T00:00:00Z',true);
  expect(hasVerifiedTextureBindingProof(legacy,sourceId,sourceHash)).toBe(false);
  expect(hasVerifiedTextureBindingProof(verified,sourceId,sourceHash)).toBe(true);
  expect(preferVerifiedTexturePreviews([legacy,verified],sourceId,sourceHash).map(item=>item.id)).toEqual(['verified','legacy']);
 });
 it('does not use proof copied from another source or from an unverified/partial output',()=>{
  const foreign={...derivative('foreign','2026-10-23T00:00:00Z',true),data:{...derivative('foreign','2026-10-23T00:00:00Z',true).data,sourceInputHash:'3'.repeat(64)}};
  const unverified={...derivative('unverified','2026-10-23T00:00:00Z',true),data:{...derivative('unverified','2026-10-23T00:00:00Z',true).data,validationChecks:{outputHashVerified:false,sourceUnmodified:true}}};
  const incomplete={...derivative('incomplete','2026-10-23T00:00:00Z',true),data:{...derivative('incomplete','2026-10-23T00:00:00Z',true).data,settings:{textureBindingProofs:{materials:[],uv:[]}}}};
  expect([foreign,unverified,incomplete].map(item=>hasVerifiedTextureBindingProof(item,sourceId,sourceHash))).toEqual([false,false,false]);
 });
 it('starts from the editable master only for automatic markup-capable loads with no verified cached derivative',()=>{
  const master={id:sourceId,data:{sourceName:'fitted-assembly.blend',hash:sourceHash}},legacy=derivative('legacy','2026-10-23T00:00:00Z',false),verified=derivative('verified','2026-10-22T00:00:00Z',true);
  expect(preferredTexturePreviewDefault([legacy,master],master.id,true)).toBe(master);
  expect(preferredTexturePreviewDefault([legacy,master],undefined,true)).toBe(legacy);
  expect(preferredTexturePreviewDefault([legacy,master],master.id,false)).toBe(legacy);
  expect(preferredTexturePreviewDefault([legacy,verified,master],master.id,true)).toBe(verified);
  expect(preferredTexturePreviewDefault([legacy,{...derivative('foreign','2026-10-23T00:00:00Z',true),data:{...derivative('foreign','2026-10-23T00:00:00Z',true).data,versionOf:'other',sourceParentId:'other',parentArtifactId:'other'}},master],master.id,true)).toBe(master);
 });
});
