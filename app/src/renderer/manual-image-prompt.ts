import type {Locale} from '../shared/i18n';
import {buildManualImagePreparationRequest,type ManualImagePromptReference} from '../shared/manual-image-prompt-content';

export function manualCharacterReferences(prompt:any):ManualImagePromptReference[]{
 const rows=prompt?.manualImageContext?.references;
 return Array.isArray(rows)?rows.filter((row:any)=>row?.path&&/^[a-f0-9]{64}$/.test(String(row.hash||''))&&String(row.source||'')!=='missing').map((row:any)=>({name:String(row.name||row.artifactId||'Reference image'),role:String(row.role||'reference image'),path:String(row.path),hash:String(row.hash)})):[];
}

/** This text is an instruction for Codex to prepare a prompt; it is never copied to an image service. */
export function manualCharacterPrompt(prompt:any,references:ManualImagePromptReference[],locale:Locale){
 const context=prompt?.manualImageContext||{},requestContext=prompt?.request?.data?.guidedContext||{},selected=requestContext.manualTargetSlot||requestContext.selection||requestContext.targetSlots?.[0]||{},slot=context.slotKey||selected.key||selected.slotId||'',slotId=context.slotId||selected.slotId;
 const target=[context.characterId||requestContext.characterId||prompt?.request?.data?.characterId,slot,context.part||selected.part,context.view||selected.view,(context.group||selected.group)?`group ${context.group||selected.group}`:null,slotId,context.workflowId||requestContext.workflowId,`revision ${context.workflowRevision??requestContext.workflowRevision}`].filter(Boolean).join(' · ');
 const purpose=context.purpose==='depth'?'depth':context.purpose==='texture-references'?'texture-reference':'color';
 return buildManualImagePreparationRequest({locale,target,purpose,canonicalRequest:String(prompt?.markdown||''),references});
}
