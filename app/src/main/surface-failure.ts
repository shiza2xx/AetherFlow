export interface SurfaceFailureSummary {
 code:string;message:string;operation:string;phase:string;recovery?:string;technicalDetails?:string;
 group?:string;object?:string|string[];face?:number;vertex?:number;
 baselineFaceCount?:number;referenceFaceCount?:number;matchedFaceCount?:number;
 candidateCount?:number;reverseCandidateCount?:number;unmatchedReferenceFaceCount?:number;
 tolerance?:number;toleranceCap?:number;maxPositionError?:number;
 nearestFaceCornerError?:number;nearestFaceCenterDistance?:number;alignmentError?:string;
 missingGroups?:string[];unexpectedGroups?:string[];baselineGroups?:string[];providedGroups?:string[];
}

const numericFacts=['face','vertex','baselineFaceCount','referenceFaceCount','matchedFaceCount','candidateCount','reverseCandidateCount','unmatchedReferenceFaceCount','tolerance','toleranceCap','maxPositionError','nearestFaceCornerError','nearestFaceCenterDistance'] as const;
const stringFacts=['group','alignmentError'] as const;
const arrayFacts=['missingGroups','unexpectedGroups','baselineGroups','providedGroups'] as const;

/** Limit renderer/MCP error payloads to reviewed diagnostics, never arbitrary helper records. */
export function surfaceFailureForClient(value:unknown):SurfaceFailureSummary|undefined{
 if(!value||typeof value!=='object')return undefined;
 const source=value as Record<string,unknown>,result:SurfaceFailureSummary={
  code:String(source.code||'SURFACE_OPERATION_FAILED').slice(0,100),
  message:String(source.message||'Guided surface operation failed.').slice(0,1000),
  operation:String(source.operation||'unknown').slice(0,80),
  phase:String(source.phase||'unknown').slice(0,80),
 };
 if(typeof source.recovery==='string')result.recovery=source.recovery.slice(0,1000);
 if(typeof source.technicalDetails==='string')result.technicalDetails=source.technicalDetails.slice(-12000);
 for(const key of stringFacts)if(typeof source[key]==='string')result[key]=String(source[key]).slice(0,500);
 if(typeof source.object==='string')result.object=source.object.slice(0,500);
 else if(Array.isArray(source.object))result.object=source.object.slice(0,20).map(item=>String(item).slice(0,200));
 for(const key of numericFacts)if(typeof source[key]==='number'&&Number.isFinite(source[key]))result[key]=source[key] as number;
 for(const key of arrayFacts)if(Array.isArray(source[key]))result[key]=source[key].slice(0,20).map(item=>String(item).slice(0,200));
 return result;
}
