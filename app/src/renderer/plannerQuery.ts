import type {Entity} from '../shared/contracts';

export type PlannerTaskView='active'|'completed'|'all'|'archived';

export function plannerTaskSummary(task:Entity,locale='en'){
 const ru=locale==='ru',parts:string[]=[];
 const status=String(task.data.status||'To do');
 parts.push(ru?({'To do':'К выполнению','In progress':'В работе','Review':'На проверке','In review':'На проверке','Blocked':'Заблокирована','Done':'Завершена','Cancelled':'Отменена'} as Record<string,string>)[status]||status:status);
 const priority=String(task.data.priority||'');if(priority)parts.push(ru?({'Low':'Низкий','Normal':'Обычный','Medium':'Средний','High':'Высокий','Urgent':'Срочно'} as Record<string,string>)[priority]||priority:priority);
 const due=String(task.data.dueDate||'');if(due){const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(due),date=new Date(dateOnly?`${due}T00:00:00.000Z`:due);parts.push(Number.isNaN(date.getTime())?due:new Intl.DateTimeFormat(locale,{dateStyle:'medium',...(dateOnly?{timeZone:'UTC'}:{})}).format(date));}
 const checklist=Array.isArray(task.data.checklist)?task.data.checklist:[];if(checklist.length){const complete=checklist.filter((item:any)=>item?.completed===true).length;parts.push(ru?`${complete}/${checklist.length} пунктов`:`${complete}/${checklist.length} items`);}
 return parts.join(' · ');
}

export function filterPlannerTasks(tasks:Entity[],query:string,planId:string,view:PlannerTaskView){
 const normalized=query.trim().toLocaleLowerCase();
 return tasks.filter(task=>{
  if(task.kind!=='task')return false;
  const archived=task.data.archived===true;
  if(view==='archived'&&!archived)return false;
  if(view!=='archived'&&view!=='all'&&archived&&normalized.length===0)return false;
  const done=task.data.status==='Done';
  if(!(archived&&normalized.length>0)&&(view==='active'&&done||view==='completed'&&!done))return false;
  if(planId!=='all'&&task.data.planId!==planId)return false;
  return !normalized||task.name.toLocaleLowerCase().includes(normalized)||String(task.data.description||'').toLocaleLowerCase().includes(normalized);
 });
}
