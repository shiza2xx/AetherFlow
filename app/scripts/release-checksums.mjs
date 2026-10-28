const SHA256=/^[a-f0-9]{64}$/;

/** Require an exact two-row checksum list bound to the current release bytes. */
export function verifyReleaseChecksums(text,{setupName,setupSha256,manifestSha256}){
  if(typeof setupName!=='string'||!/^AetherFlow-Setup-\d+\.\d+\.\d+\.exe$/.test(setupName))throw new Error('The release setup checksum name is invalid.');
  if(!SHA256.test(setupSha256)||!SHA256.test(manifestSha256))throw new Error('Expected release SHA-256 values are invalid.');
  if(typeof text!=='string'||!text.endsWith('\n'))throw new Error('The release checksum file is empty or does not end with a newline.');
  const rows=text.replace(/\r?\n/g,'\n').slice(0,-1).split('\n');
  if(rows.length!==2)throw new Error('The release checksum file must contain exactly two rows.');
  const entries=new Map();
  for(const row of rows){
    const match=row.match(/^([a-f0-9]{64})  release\/([^/\\]+)$/);
    if(!match)throw new Error('A release checksum row has an invalid digest or unsafe path.');
    if(entries.has(match[2]))throw new Error('The release checksum file contains a duplicate target.');
    entries.set(match[2],match[1]);
  }
  if(entries.size!==2||!entries.has(setupName)||!entries.has('update-manifest.json'))throw new Error('The release checksum targets must be exactly the current setup and update manifest.');
  if(entries.get(setupName)!==setupSha256)throw new Error('The installer SHA-256 does not match the current release checksum row.');
  if(entries.get('update-manifest.json')!==manifestSha256)throw new Error('The update manifest SHA-256 does not match the current release checksum row.');
  return {verified:true,targets:[setupName,'update-manifest.json']};
}
