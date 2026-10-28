import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateUpdateManifest} from '../src/shared/update-manifest.mjs';
import {verifyReleaseChecksums} from './release-checksums.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const evidence=path.join(root,'evidence','aetherflow-'+packageJson.version.replaceAll('.','')+'-codex-launch-recovery');
const build=JSON.parse(fs.readFileSync(path.join(evidence,'build-receipt.json'),'utf8'));
const artifact=path.join(root,build.artifact),rawPayload=path.join(root,'release','nsis-payload',`AetherFlow-NSIS-${build.version}.exe`),manifest=JSON.parse(fs.readFileSync(path.join(root,'release','update-manifest.json'),'utf8'));
const checksumsPath=path.join(root,'release','SHA256SUMS.txt');
const keySource=fs.readFileSync(path.join(root,'src','shared','update-public-key.ts'),'utf8'),publicKey=keySource.match(/UPDATE_PUBLIC_KEY_PEM\s*=\s*'([\s\S]*?)';/)?.[1]?.replaceAll('\\n','\n');
const hashFile=async(file,algorithm)=>{const hash=crypto.createHash(algorithm);for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};

const artifactStat=fs.statSync(artifact),rawStat=fs.statSync(rawPayload),artifactSha256=await hashFile(artifact,'sha256'),artifactSha512=await hashFile(artifact,'sha512'),rawSha512=await hashFile(rawPayload,'sha512');
const fd=fs.openSync(artifact,'r');let footer;
try{footer=Buffer.alloc(144);fs.readSync(fd,footer,0,footer.length,artifactStat.size-footer.length);}finally{fs.closeSync(fd);}
assert(footer.subarray(0,8).toString('ascii')==='AFSETUP1','The wrapper payload footer is missing.');
const footerPayloadBytes=Number(footer.readBigInt64LE(8)),footerPayloadSha512=footer.toString('ascii',16,144);
const manifestStatus=validateUpdateManifest(manifest,{currentVersion:'0.0.0',publicKey});
const expectedArtifact=`AetherFlow-Setup-${packageJson.version}.exe`;
assert(build.version===packageJson.version&&manifest.version===packageJson.version&&build.artifact.replaceAll('\\','/')===`release/${expectedArtifact}`,'Package, build receipt, artifact path, and signed manifest versions do not match.');
assert(artifactStat.size===build.artifactBytes&&artifactSha256===build.artifactSha256&&artifactSha512===build.artifactSha512,'Final wrapper bytes differ from the build receipt.');
assert(rawStat.size===build.rawPayloadBytes&&rawSha512===build.rawPayloadSha512,'Raw NSIS payload differs from the build receipt.');
assert(footerPayloadBytes===rawStat.size&&footerPayloadSha512===rawSha512,'Setup footer does not authenticate the exact raw NSIS payload.');
assert(manifest.assetName===path.basename(artifact)&&manifest.size===artifactStat.size&&manifest.sha512===artifactSha512&&manifestStatus.available,'Signed update metadata does not bind the final setup artifact.');
const manifestSha256=await hashFile(path.join(root,'release','update-manifest.json'),'sha256'),checksumVerification=verifyReleaseChecksums(fs.readFileSync(checksumsPath,'utf8'),{setupName:expectedArtifact,setupSha256:artifactSha256,manifestSha256});
const receipt={schemaVersion:1,artifact:build.artifact,artifactBytes:artifactStat.size,artifactSha256,artifactSha512,rawPayloadBytes:rawStat.size,rawPayloadSha512:rawSha512,footerBytes:footer.length,footerPayloadBytes,footerPayloadSha512,footerMatchesRawPayload:true,manifest:'release/update-manifest.json',manifestSha256,manifestSignatureValid:true,manifestAssetIdentityValid:true,manifestStatus,checksumVerification,version:build.version,keyFingerprintSha256:crypto.createHash('sha256').update(publicKey).digest('hex'),privateKeyBytesRecorded:false,authenticodeSigned:false,installationExecuted:false,updateExecuted:false,uninstallExecuted:false,publishExecuted:false};
fs.writeFileSync(path.join(evidence,'manifest-verification.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));

if(process.argv[1]&&fileURLToPath(import.meta.url)!==path.resolve(process.argv[1]))throw new Error('Release output verifier must run as a direct command.');
