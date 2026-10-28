import {describe,expect,it} from 'vitest';
import type {Entity} from '../shared/contracts';
import {filterPlannerTasks,plannerTaskSummary} from './plannerQuery';

const task=(id:string,status:string,planId='plan-a',description='')=>({id,kind:'task',name:`Task ${id}`,data:{status,planId,description}} as unknown as Entity);

describe('planner query',()=>{
 const rows=[task('1','To do'),task('2','Done'),task('3','In progress','plan-b','needle')];
 it('keeps the active board intentional while making completed tasks searchable',()=>{
  expect(filterPlannerTasks(rows,'','all','active').map(row=>row.id)).toEqual(['1','3']);
  expect(filterPlannerTasks(rows,'Task 2','all','completed').map(row=>row.id)).toEqual(['2']);
  expect(filterPlannerTasks(rows,'needle','all','all').map(row=>row.id)).toEqual(['3']);
 });
 it('searches the full dataset before card-window rendering and honors plan filters',()=>{
  const many=Array.from({length:3000},(_,index)=>task(String(index),index===2999?'Done':'To do'));
  expect(filterPlannerTasks(many,'Task 2999','all','completed').map(row=>row.id)).toEqual(['2999']);
  expect(filterPlannerTasks(rows,'needle','plan-a','all')).toEqual([]);
 });
 it('summarizes only useful task metadata without inventing absent fields',()=>{
  const detailed={...task('4','In progress'),data:{status:'In progress',priority:'High',dueDate:'2026-11-03',checklist:[{completed:true},{completed:false}]}} as unknown as Entity;
  expect(plannerTaskSummary(detailed,'en')).toMatch(/In progress.*High.*Nov 3, 2026.*1\/2 items/);
  expect(plannerTaskSummary(task('5','To do'),'ru')).toBe('К выполнению');
 });
 it('keeps date-only due dates on the same calendar day west of UTC and localizes Review',()=>{
  const previous=process.env.TZ;
  try{process.env.TZ='America/Los_Angeles';const dated={...task('tz','Review'),data:{status:'Review',dueDate:'2026-11-03'}} as unknown as Entity;expect(plannerTaskSummary(dated,'en')).toMatch(/Review.*Nov 3, 2026/);expect(plannerTaskSummary(dated,'ru')).toContain('На проверке');expect(plannerTaskSummary(dated,'ru')).toContain('3 нояб. 2026 г.');}
  finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
 });
 it('hides archived work by default while exposing labeled records in Archive and search',()=>{
  const archived={...task('archived','Done','plan-a','preserved dependency evidence'),data:{...task('archived','Done').data,description:'preserved dependency evidence',archived:true}} as unknown as Entity;
  expect(filterPlannerTasks([archived],'','all','active')).toEqual([]);
  expect(filterPlannerTasks([archived],'','all','completed')).toEqual([]);
  expect(filterPlannerTasks([archived],'','all','archived')).toEqual([archived]);
  expect(filterPlannerTasks([archived],'preserved','all','active')).toEqual([archived]);
 });
});
