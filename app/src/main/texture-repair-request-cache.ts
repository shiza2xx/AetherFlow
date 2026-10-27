import crypto from 'node:crypto';

export const textureRepairPromptContractVersion='texture-spatial-repair-v2';

export type TextureRepairRequestCacheIdentity={
 draftHash:string;
 sourceHash:string;
 manifestHash:string;
 attachmentDigest:string;
 locale:'en'|'ru';
 promptContractVersion:string;
 skillClosureFingerprint:string;
};

export function textureRepairAttachmentDigest(attachments:readonly unknown[]):string{
 return crypto.createHash('sha256').update(JSON.stringify(attachments)).digest('hex');
}

export function textureRepairRequestCacheMatches(cached:unknown,expected:TextureRepairRequestCacheIdentity):boolean{
 if(!cached||typeof cached!=='object')return false;
 const value=cached as Partial<TextureRepairRequestCacheIdentity>;
 return value.draftHash===expected.draftHash&&value.sourceHash===expected.sourceHash&&value.manifestHash===expected.manifestHash&&value.attachmentDigest===expected.attachmentDigest&&value.locale===expected.locale&&value.promptContractVersion===expected.promptContractVersion&&value.skillClosureFingerprint===expected.skillClosureFingerprint;
}
