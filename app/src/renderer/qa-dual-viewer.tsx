import '@fontsource-variable/manrope';
import React,{useEffect,useState} from 'react';import * as THREE from 'three';
import{createRoot}from'react-dom/client';
import type{Entity}from'../shared/contracts';
import ThreeViewer from './ThreeViewer';
import './styles.css';
function DualViewer(){
 const [character,setCharacter]=useState<Entity|null>(null),[files,setFiles]=useState<Entity[]>([]),[leftMounted,setLeftMounted]=useState(true);
 useEffect(()=>{let live=true;const id=new URLSearchParams(location.search).get('characterId');if(!id)return;void (async()=>{const [characterResult,artifacts]=await Promise.all([window.atelier.call({op:'get',kind:'character',id}),window.atelier.call({op:'list',query:{kind:'artifact',limit:500,offset:0}})]);if(!live||!characterResult.ok||!artifacts.ok)return;const direct=(artifacts.data as Entity[]).filter(item=>item.data.parentId===id),roots=direct.filter(item=>/\.blend$/i.test(String(item.data.sourceName||item.name))&&!item.data.versionOf),histories=await Promise.all(roots.map(item=>window.atelier.call({op:'history:list',id:item.id})));if(!live)return;const all=[...direct,...histories.flatMap(result=>result.ok?result.data as Entity[]:[])];setCharacter(characterResult.data);setFiles([...new Map(all.map(item=>[item.id,item])).values()]);})();return()=>{live=false};},[]);
 return <main className="qa-dual-layout">{character?<><section className="qa-controls"><button onClick={()=>setLeftMounted(value=>!value)}>{leftMounted?'Unmount left':'Mount left'}</button></section>{['left','right'].filter(pane=>pane!=='left'||leftMounted).map(pane=><section className="dual-pane" data-pane={pane} key={pane}><header>Rendered viewer - {pane}</header><ThreeViewer character={character} files={files}/></section>)}</>:<p>Loading compact managed QA character...</p>}</main>;
}
const qaDisposals:string[]=[];const disposeMaterial=THREE.Material.prototype.dispose;THREE.Material.prototype.dispose=function(){qaDisposals.push(this.uuid);return disposeMaterial.call(this)};(window as any).__qaMaterialDisposals=qaDisposals;document.documentElement.dataset.theme='dark';createRoot(document.getElementById('qa-root')!).render(<DualViewer/>);
