import {describe,it,expect} from 'vitest';
import {resolveDashboardReturn} from './dashboardReturn';
import type {Entity} from '../shared/contracts';

const character={id:'d17bf0f4-8b0e-4d7d-9e34-1efec5827a68',kind:'character',name:'Monster',data:{definitionVersion:2},revision:1,createdAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:00.000Z'} as Entity;

describe('Dashboard return to character',()=>{
 it('resolves the current character document and falls back when its target is gone',()=>{
  expect(resolveDashboardReturn(character.id,[character])).toEqual({entity:character,screen:'Characters'});
  expect(resolveDashboardReturn(character.id,[])).toEqual({entity:null,screen:'Characters'});
  expect(resolveDashboardReturn(character.id,[{...character,kind:'unityReport'}])).toEqual({entity:null,screen:'Characters'});
 });
});
