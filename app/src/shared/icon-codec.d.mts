export type IconSource={width:number;height:number;data:Uint8Array};
export const ICON_SIZES:number[];
export function resizeIcon(source:IconSource,size:number):Uint8Array;
export function encodeIco(source:IconSource,sizes?:number[]):Buffer;
