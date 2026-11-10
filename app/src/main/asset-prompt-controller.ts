import type {Locale} from '../shared/i18n';
import {assetProductionPrompt,assetStagePrompt,type AssetPromptContext,type AssetPromptSelection} from '../shared/asset-prompt';

export type AssetPromptTerminal={id:string;status:string;assetJobId?:string|null};
export type AssetPromptSendInput={id:string;terminalId:string;expectedJobRevision:number;expectedWorkflowRevision:number;confirmedIdle:boolean;selection?:AssetPromptSelection};

export function prepareAssetPromptResponse(context:AssetPromptContext,selection:AssetPromptSelection|undefined,locale:Locale){
 const scopedSelection=selection?{...selection,locale}:undefined;
 const markdown=scopedSelection?assetStagePrompt(locale,context,scopedSelection):assetProductionPrompt(locale,context);
 return {jobId:context.job.id,jobRevision:context.job.revision,workflowRevision:context.workflow.revision,selection:scopedSelection||null,markdown};
}

export function prepareAssetPromptSend(context:AssetPromptContext,state:AssetPromptTerminal|undefined,input:AssetPromptSendInput,locale:Locale){
 if(!state||state.id!==input.terminalId||state.status!=='running'||state.assetJobId!==input.id)throw Object.assign(new Error('The active terminal belongs to another owner.'),{code:'REQUEST_OWNER_MISMATCH'});
 if(context.job.id!==input.id)throw Object.assign(new Error('Asset job changed; refresh the prompt.'),{code:'REQUEST_OWNER_MISMATCH'});
 if(context.job.revision!==input.expectedJobRevision||context.workflow.revision!==input.expectedWorkflowRevision)throw Object.assign(new Error('Asset state changed; refresh the prompt.'),{code:'REVISION_CONFLICT'});
 return input.selection?assetStagePrompt(locale,context,{...input.selection,locale}):assetProductionPrompt(locale,context);
}
