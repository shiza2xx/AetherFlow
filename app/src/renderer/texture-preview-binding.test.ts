import {describe,expect,it} from 'vitest';
import {formatTexturePreviewBindingError,texturePreviewBindingErrorMessage,texturePreviewBindingFailure,type TexturePreviewBindingCheck} from './texture-preview-binding';

const sourceId='source-fit',sourceHash='1'.repeat(64),viewerId='proof-preview',viewerHash='2'.repeat(64);
const captured=[
 {meshName:'Atelier_upper_body',materialName:'tripo_mat_3436c2a1',imageName:'upper_body_basecolor',decodedPixelHash:'b936ad115ed42a901f7e05ecbd2bee7ba3732075556e2ca9e220c07b4c657642',displayUvSignature:'94e2846e'},
 {meshName:'Atelier_lower_body',materialName:'tripo_mat_b143f6d9',imageName:'lower_body_basecolor',decodedPixelHash:'d845e1e2db1eb4af4f264494d095fd18f4153ed4adacf841358e2c3c72b6ad3c',displayUvSignature:'27f1718a'},
 {meshName:'Atelier_head',materialName:'tripo_mat_cb92b7f0',imageName:'head_basecolor',decodedPixelHash:'d6506658821f8af4b714abf70b0543c9f2d967a922360f4dcc6ecb260b820449',displayUvSignature:'9f3b03fb'},
 {meshName:'Atelier_hair',materialName:'tripo_mat_58408882',imageName:'hair_basecolor',decodedPixelHash:'3325873b6adbb134ccbaf8bdfb9151971313220483711ee3df12ab31c3731573',displayUvSignature:'cf246560'},
 {meshName:'Atelier_accessories',materialName:'tripo_mat_326b51cb',imageName:'tail_basecolor',decodedPixelHash:'6b780b1a3351d01bfa9bc737feea5ce76fc084542491156693efbf1e2499cd03',displayUvSignature:'18089e56'},
];
const proof={materials:captured.map(row=>({material:row.materialName,maps:{baseColor:{image:row.imageName,width:4096,height:4096,decodedPixelHash:row.decodedPixelHash,decoded:true}}})),uv:captured.map(row=>({object:row.meshName,layers:['UVMap']}))};
function check(row:typeof captured[number]):TexturePreviewBindingCheck{return {binding:{meshName:row.meshName,materialName:row.materialName,materialSlot:0,imageNodeName:'Image Texture',uvSet:'UVMap',uvIndex:0,uvDigest:'verified-source-loop-digest',displayUvSignature:row.displayUvSignature},meshName:row.meshName,materialName:row.materialName,materialSlot:0,imageName:row.imageName,expectedImageName:row.imageName,uvAttributePresent:true,uvSignature:row.displayUvSignature,previewId:viewerId,previewHash:viewerHash,sourceHash,expectedPreviewId:viewerId,expectedPreviewHash:viewerHash,expectedSourceHash:sourceHash,previewProof:proof,imageWidth:4096,imageHeight:4096,decodedPixelHash:row.decodedPixelHash};}

describe('source-to-preview material and UV binding',()=>{
 it('shows a concise localized binding error while preserving diagnostics for technical details',()=>{
  const raw=formatTexturePreviewBindingError('The displayed UV coordinates do not match the verified Blender source.','body/cloth/0/basecolor','Body/cloth/0/albedo [uv]');
  expect(texturePreviewBindingErrorMessage(raw,'ru')).toMatch(/Технические сведения/);
  expect(texturePreviewBindingErrorMessage(raw,'ru')).not.toContain('UV coordinates');
  expect(JSON.parse(raw.slice('TEXTURE_PREVIEW_BINDING_FAILURE:'.length))).toEqual({reason:'The displayed UV coordinates do not match the verified Blender source.',sources:'body/cloth/0/basecolor',previews:'Body/cloth/0/albedo [uv]'});
  expect(texturePreviewBindingErrorMessage('unrelated error','ru')).toBeNull();
 });
 it('accepts the five actual fitted-character mesh/material/texture/UV signatures',()=>{
  expect(captured.map(row=>texturePreviewBindingFailure(check(row)))).toEqual([null,null,null,null,null]);
 });
 it('rejects the legacy duplicate without proof, mismatched UV, image pixels, or preview identity',()=>{
  const valid=check(captured[0]);
  expect(texturePreviewBindingFailure({...valid,previewProof:undefined})).toMatch(/no verified material image proof/i);
  expect(texturePreviewBindingFailure({...valid,uvSignature:'00000000'})).toMatch(/UV coordinates do not match/i);
  expect(texturePreviewBindingFailure({...valid,decodedPixelHash:'f'.repeat(64)})).toMatch(/image proof does not match/i);
  expect(texturePreviewBindingFailure({...valid,previewId:'foreign-preview'})).toMatch(/identity or source hash/i);
 });
});
