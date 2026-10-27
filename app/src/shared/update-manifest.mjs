import crypto from 'node:crypto';

export const UPDATE_REPOSITORY='shiza2xx/AetherFlow';
export const UPDATE_MANIFEST_URL='https://github.com/shiza2xx/AetherFlow/releases/latest/download/update-manifest.json';
export const TRUSTED_UPDATE_HOSTS=Object.freeze(new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']));
const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PAYLOAD_FIELDS=['schemaVersion','repository','version','assetName','size','sha512'];

function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=stable(value[key]);return out;}return value;}
export function canonicalUpdatePayload(manifest){const payload={};for(const key of PAYLOAD_FIELDS)payload[key]=manifest?.[key];return JSON.stringify(stable(payload));}
export function compareSemver(left,right){const a=String(left).match(VERSION),b=String(right).match(VERSION);if(!a||!b)throw new Error('Update version is not valid semantic version data.');for(let i=1;i<=3;i++){const av=BigInt(a[i]),bv=BigInt(b[i]);if(av!==bv)return av>bv?1:-1;}const ap=a[4],bp=b[4];if(ap===undefined||bp===undefined)return ap===bp?0:ap===undefined?1:-1;if(ap===bp)return 0;const ai=ap.split('.'),bi=bp.split('.');for(let i=0;i<Math.max(ai.length,bi.length);i++){if(ai[i]===undefined)return -1;if(bi[i]===undefined)return 1;if(ai[i]===bi[i])continue;const an=/^(0|[1-9]\d*)$/.test(ai[i]),bn=/^(0|[1-9]\d*)$/.test(bi[i]);if(an&&bn)return BigInt(ai[i])>BigInt(bi[i])?1:-1;if(an!==bn)return an?-1:1;return ai[i]>bi[i]?1:-1;}return 0;}
export function updateAssetUrl(version,assetName){if(!VERSION.test(String(version))||assetName!==`AetherFlow-Setup-${version}.exe`)throw new Error('Update asset identity is invalid.');return `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/${assetName}`;}
export function validateUpdateManifest(raw,{currentVersion,publicKey,maxBytes=1_048_576}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==PAYLOAD_FIELDS.length+1||raw.schemaVersion!==1||raw.repository!==UPDATE_REPOSITORY)throw new Error('Update manifest format or repository is invalid.');
 if(!VERSION.test(String(raw.version)))throw new Error('Update manifest version is invalid.');
 const expectedAsset=`AetherFlow-Setup-${raw.version}.exe`;if(raw.assetName!==expectedAsset||/[\\/:?#%\0]/.test(String(raw.assetName)))throw new Error('Update installer asset name is invalid.');
 if(!Number.isSafeInteger(raw.size)||raw.size<256*1024||raw.size>2*1024*1024*1024)throw new Error('Update installer size is outside the supported range.');
 if(typeof raw.sha512!=='string'||!/^[a-f0-9]{128}$/.test(raw.sha512))throw new Error('Update installer SHA-512 is invalid.');
 if(typeof raw.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(raw.signature))throw new Error('Update signature is malformed.');
 if(!publicKey||!crypto.verify(null,Buffer.from(canonicalUpdatePayload(raw)),publicKey,Buffer.from(raw.signature,'base64')))throw new Error('Update signature verification failed.');
 if(currentVersion!==undefined&&compareSemver(String(raw.version),String(currentVersion))<=0)return {available:false,version:String(raw.version)};
 return {available:true,schemaVersion:1,repository:UPDATE_REPOSITORY,version:String(raw.version),assetName:expectedAsset,size:raw.size,sha512:raw.sha512,url:updateAssetUrl(raw.version,expectedAsset)};
}

export function signUpdateManifest(payload,privateKey){const signed={...payload,signature:crypto.sign(null,Buffer.from(canonicalUpdatePayload(payload)),privateKey).toString('base64')};return signed;}
