import type {TextureMarkStroke} from './texture-mark-history';

export type TextureMarkGestureBuffer=Map<string,TextureMarkStroke[]>;

export function createTextureMarkGestureBuffer():TextureMarkGestureBuffer{return new Map();}

export function appendTextureMarkGestureSegment(buffer:TextureMarkGestureBuffer,key:string,stroke:TextureMarkStroke){
  const rows=buffer.get(key)||[];
  buffer.set(key,[...rows,stroke]);
}

export function textureMarkGestureChanges(buffer:TextureMarkGestureBuffer,committed:Map<string,TextureMarkStroke[]>):Array<[string,TextureMarkStroke[]]>{
  return [...buffer].map(([key,segments])=>[key,[...(committed.get(key)||[]),...segments]]);
}
