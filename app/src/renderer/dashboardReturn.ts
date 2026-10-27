import type {Entity} from '../shared/contracts';

export function resolveDashboardReturn(characterId:string,entities:Entity[]){
 const target=entities.find(entity=>entity.id===characterId&&entity.kind==='character');
 return target?{entity:target,screen:'Characters' as const}:{entity:null,screen:'Characters' as const};
}
