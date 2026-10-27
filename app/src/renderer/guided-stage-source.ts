export function currentAcceptedFittedSlot(slots:readonly any[],headFit:any){
 if(headFit?.current!==true||headFit?.confirmed!==true||headFit?.repairRequired===true)return null;
 const artifactId=headFit.artifactId||headFit.outputArtifactId,hash=headFit.hash||headFit.outputHash;
 return slots.find(slot=>slot.key==='fitted-assembly'&&slot.operativeStale!==true&&(slot.operativeArtifactId||slot.artifactId)===artifactId&&slot.reviewStatus==='accepted'&&(!hash||(slot.operativeHash||slot.hash)===hash))||null;
}

export function currentRigSourceSlot(slots:readonly any[],headFit:any,geometryBaseline:any){
 const fitted=currentAcceptedFittedSlot(slots,headFit),baseline=geometryBaseline,mesh=slots.find(slot=>slot.key==='mesh-only-fbx'),geometry=slots.find(slot=>slot.key==='geometry-baseline'),surface=slots.find(slot=>slot.key==='surface-baseline');
 if(!fitted||!mesh?.artifactId||!geometry?.artifactId||!surface?.artifactId||!baseline||baseline.current===false)return null;
 const fitHash=String(fitted.hash||''),meshHash=String(mesh.hash||mesh.artifact?.data?.hash||''),geometryHash=String(geometry.hash||geometry.artifact?.data?.hash||'');
 const sameFit=baseline.fittedAssemblyArtifactId===fitted.artifactId&&baseline.fittedAssemblyHash===fitHash&&baseline.proof?.sourceHashes?.assembled===fitHash;
 const sameBaseline=baseline.artifactId===geometry.artifactId&&baseline.hash===baseline.verifiedHash&&baseline.hash===geometryHash;
 const validMesh=mesh.reviewStatus!=='invalidated'&&mesh.reviewStatus!=='rejected'&&mesh.artifact?.id===mesh.artifactId&&mesh.artifact?.data?.hash===meshHash&&/\.fbx$/i.test(String(mesh.artifact?.data?.sourceName||mesh.artifact?.name||''));
 return sameFit&&sameBaseline&&validMesh?mesh:null;
}

export function preferredGuidedStageSourceId(stepKey:string,slots:readonly any[],headFit:any,geometryBaseline?:any,fitPrerequisitesAccepted=false){
 if(stepKey==='receive-materials')return currentAcceptedFittedSlot(slots,headFit)?.id||(fitPrerequisitesAccepted&&!slots.find(slot=>slot.key==='fitted-assembly')?.artifactId?slots.find(slot=>slot.key==='fitted-assembly')?.id||null:null);
 if(stepKey==='export-rig-source'){const fitted=currentAcceptedFittedSlot(slots,headFit);if(fitted?.workbenchCorrection&&['materials','textures'].includes(String(fitted.workbenchPurpose)))return fitted.id;return currentRigSourceSlot(slots,headFit,geometryBaseline)?.id||fitted?.id||null;}
 return null;
}
