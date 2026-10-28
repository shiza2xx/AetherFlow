import {useEffect,useMemo,useState} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import type {ComponentType,CSSProperties} from 'react';
import type {LucideProps} from 'lucide-react';

type Route={name:string;icon:ComponentType<LucideProps>};
type Props={compact?:boolean;routes:Route[];screen:string;locale:string;onNavigate:(route:string)=>void;taskCount:number};
const groups=[{id:'Studio',en:'Studio',ru:'Студия',routes:['Dashboard','Planner','Notebook','Settings']},{id:'Assets',en:'Assets',ru:'Материалы',routes:['Gallery','Characters']},{id:'Unity',en:'Unity',ru:'Unity',routes:['Unity Activity']}];

export default function BranchedNavigation({compact=false,routes,screen,locale,onNavigate,taskCount}:Props){
 const activeGroup=groups.find(group=>group.routes.includes(screen))?.id||'Studio';
 const [expanded,setExpanded]=useState<Record<string,boolean>>({Studio:true,Assets:true,Unity:true});
 useEffect(()=>setExpanded(current=>current[activeGroup]?current:{...current,[activeGroup]:true}),[activeGroup]);
 const routeByName=useMemo(()=>new Map(routes.map(route=>[route.name,route])),[routes]);
 const toggle=(id:string)=>setExpanded(current=>({...current,[id]:!current[id]}));
 return <nav className="branched-nav" aria-label={locale==='ru'?'Разделы студии':'Studio sections'}>{groups.map(group=>{
  const open=Boolean(expanded[group.id]),groupId=`branched-${group.id.toLowerCase()}`,activeIndex=group.routes.indexOf(screen);
  return <section className={`branch-group${open?' is-open':''}${activeGroup===group.id?' has-active':''}`} key={group.id}>
   <button type="button" className="branch-trigger" aria-expanded={open} aria-controls={groupId} onClick={()=>toggle(group.id)}><span className="branch-joint" aria-hidden="true"/>{open?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<span>{locale==='ru'?group.ru:group.en}</span><i aria-hidden="true"/></button>
   <div className="branch-items" id={groupId} hidden={!compact&&!open} style={activeGroup===group.id?{'--active-branch-y':`${8+Math.max(0,activeIndex)*41}px`} as CSSProperties:undefined}>{group.routes.map(name=>{const route=routeByName.get(name);if(!route)return null;const Icon=route.icon;return <button type="button" key={name} data-tooltip={compact?(locale==='ru'?({'Dashboard':'Обзор','Planner':'Планирование','Gallery':'Галерея','Characters':'Персонажи','Unity Activity':'Работа в Unity','Settings':'Настройки','Notebook':'Блокнот'} as Record<string,string>)[name]:name):undefined} aria-label={name==='Planner'&&taskCount>0?`${locale==='ru'?'Планирование':'Planner'}, ${taskCount} ${locale==='ru'?'открытых задач':'open tasks'}`:locale==='ru'?({'Dashboard':'Обзор','Planner':'Планирование','Gallery':'Галерея','Characters':'Персонажи','Unity Activity':'Работа в Unity','Settings':'Настройки','Notebook':'Блокнот'} as Record<string,string>)[name]:name} aria-current={screen===name?'page':undefined} className={`nav-item ${screen===name?'active':''}`} onClick={()=>onNavigate(name)}><Icon size={17}/><span>{locale==='ru'?({'Dashboard':'Обзор','Planner':'Планирование','Gallery':'Галерея','Characters':'Персонажи','Unity Activity':'Работа в Unity','Settings':'Настройки','Notebook':'Блокнот'} as Record<string,string>)[name]:name}</span>{name==='Planner'&&taskCount>0&&<span className="nav-count">{taskCount}</span>}</button>;})}</div>
  </section>;
 })}</nav>;
}
