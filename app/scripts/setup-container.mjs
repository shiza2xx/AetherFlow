export const SETUP_FOOTER_BYTES=144;

export function createSetupFooter(payloadLength,sha512){
 if(!Number.isSafeInteger(payloadLength)||payloadLength<=0)throw new Error('Setup payload length is invalid.');
 if(typeof sha512!=='string'||!/^[a-f0-9]{128}$/i.test(sha512))throw new Error('Setup payload SHA-512 is invalid.');
 const footer=Buffer.alloc(SETUP_FOOTER_BYTES);
 footer.write('AFSETUP1',0,'ascii');
 footer.writeBigInt64LE(BigInt(payloadLength),8);
 footer.write(sha512,16,'ascii');
 return footer;
}
