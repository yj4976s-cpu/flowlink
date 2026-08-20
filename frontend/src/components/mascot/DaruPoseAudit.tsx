"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import type { DaruRhythm } from "./types";
import styles from "./DaruPoseAudit.module.css";

type Mark = "head" | "body" | "leftHand" | "rightHand" | "leftFoot" | "rightFoot";
type Point = { x: number; y: number };
type Phase = "UNKNOWN" | "CONTACT" | "DOWN" | "PASSING" | "UP";
type FrameAudit = { marks: Partial<Record<Mark, Point>>; phase: Phase; leftContact: boolean; rightContact: boolean };
const SIZE = 1254;
const PAIRS = [[0, 4], [1, 5], [2, 6], [3, 7]] as const;
const MARKS: readonly [Mark, string][] = [["head","Head"],["body","Body"],["leftHand","L Hand"],["rightHand","R Hand"],["leftFoot","L Foot"],["rightFoot","R Foot"]];
const PHASES: Phase[] = ["UNKNOWN", "CONTACT", "DOWN", "PASSING", "UP"];
const fresh = () => Array.from({ length: 8 }, (): FrameAudit => ({ marks: {}, phase: "UNKNOWN", leftContact: false, rightContact: false }));
const pixel = (n: number) => Math.round(n * SIZE);
const mirror = (p?: Point) => p ? { x: 1 - p.x, y: p.y } : undefined;
const dist = (a?: Point, b?: Point) => a && b ? Math.hypot(a.x-b.x, a.y-b.y) * SIZE : null;
const displayError = (n: number | null) => n === null ? "—" : `${Math.round(n)}px`;

function ImagePanel({ src, index, audit, activeMark, guides, setPoint }: { src: string; index: number; audit: FrameAudit; activeMark: Mark; guides: Record<string, boolean>; setPoint: (p: Point) => void }) {
  return <div className={styles.imagePanel}><strong>FRAME {String(index+1).padStart(2,"0")}</strong><button type="button" className={styles.image} onClick={(event) => { const r=event.currentTarget.getBoundingClientRect(); setPoint({ x:(event.clientX-r.left)/r.width, y:(event.clientY-r.top)/r.height }); }} aria-label={`Set ${activeMark} on frame ${index+1}`}>
    <img src={src} alt="" draggable={false}/>
    {guides.ground && <i className={`${styles.guide} ${styles.ground}`}/>}
    {guides.center && <i className={`${styles.guide} ${styles.center}`}/>}
    {guides.head && audit.marks.head && <i className={styles.level} style={{top:`${audit.marks.head.y*100}%`}}/>}{guides.body && audit.marks.body && <i className={styles.level} style={{top:`${audit.marks.body.y*100}%`}}/>}
    {guides.foot && [audit.marks.leftFoot,audit.marks.rightFoot].map((p,i) => p && <i key={i} className={styles.level} style={{top:`${p.y*100}%`}}/>)}
    {MARKS.map(([key,label]) => audit.marks[key] && <i key={key} className={styles.marker} style={{left:`${audit.marks[key]!.x*100}%`,top:`${audit.marks[key]!.y*100}%`}} title={`${label}: ${pixel(audit.marks[key]!.x)}, ${pixel(audit.marks[key]!.y)}`}>{label[0]}</i>)}
  </button></div>;
}

function Chart({ title, lines }: { title: string; lines: { name:string; color:string; values:(number|undefined)[] }[] }) {
  const points=(values:(number|undefined)[])=>values.map((v,i)=>v===undefined?null:`${18+i*40},${10+v*72}`).filter(Boolean).join(" ");
  return <div className={styles.chart}><strong>{title}</strong><svg viewBox="0 0 316 96"><path d="M18 82H298M18 10V82"/>{lines.map(line=><polyline key={line.name} points={points(line.values)} style={{stroke:line.color}}/>)}{Array.from({length:8},(_,i)=><text key={i} x={18+i*40} y="94">{i+1}</text>)}</svg><p>{lines.map(line=><span key={line.name} style={{color:line.color}}>{line.name}</span>)}</p></div>;
}

export function DaruPoseAudit({ theme, frames }: { theme: DaruRhythm; frames: readonly string[] }) {
  const [pair, setPair] = useState(0), [mode,setMode]=useState<"overlay"|"blink">("overlay"), [opacity,setOpacity]=useState(50), [mirrorB,setMirrorB]=useState(false), [blinkB,setBlinkB]=useState(true);
  const [activeMark,setActiveMark]=useState<Mark>("head"), [guides,setGuides]=useState({ground:true,center:true,head:false,body:false,foot:false});
  const [all,setAll]=useState<Record<DaruRhythm,FrameAudit[]>>({day:fresh(),dawn:fresh(),night:fresh()}), [checks,setChecks]=useState<boolean[]>(Array(9).fill(false));
  const [a,b]=PAIRS[pair], data=all[theme];
  useEffect(()=>{ if(mode!=="blink") return; const id=window.setInterval(()=>setBlinkB(v=>!v),500); return()=>window.clearInterval(id); },[mode]);
  const update=(index:number,fn:(v:FrameAudit)=>FrameAudit)=>setAll(current=>({...current,[theme]:current[theme].map((v,i)=>i===index?fn(v):v)}));
  const mark=(index:number,p:Point)=>update(index,v=>({...v,marks:{...v.marks,[activeMark]:p}}));
  const errors=useMemo(()=>{const x=data[a].marks,y=data[b].marks; const average=(v:(number|null)[])=>{const n=v.filter((q):q is number=>q!==null);return n.length?n.reduce((s,q)=>s+q,0)/n.length:null};return {foot:average([dist(x.leftFoot,mirror(y.rightFoot)),dist(x.rightFoot,mirror(y.leftFoot))]),hand:average([dist(x.leftHand,mirror(y.rightHand)),dist(x.rightHand,mirror(y.leftHand))]),body:dist(x.body,mirror(y.body)),head:dist(x.head,mirror(y.head))};},[a,b,data]);
  const checkLabels=["01 / 05 contact legs alternate","02 / 06 weight legs alternate","03 / 07 passing legs alternate","04 / 08 next contact legs alternate","Arms alternate opposite the legs","Half-cycle stride sizes are similar","Planted foot remains stable during contact","Body Y curves match across half-cycles","Head motion is not excessive"];
  return <section className={styles.audit} aria-labelledby="pose-audit"><header><div><p>Original 8 diagnostic tool</p><h2 id="pose-audit">POSE AUDIT</h2></div><span>{theme.toUpperCase()} · raw 1254×1254 · no asset mutation</span></header>
    <nav className={styles.pairs}>{PAIRS.map(([x,y],i)=><button type="button" key={x} data-active={pair===i||undefined} onClick={()=>setPair(i)}>{String(x+1).padStart(2,"0")} ↔ {String(y+1).padStart(2,"0")}</button>)}</nav>
    <div className={styles.side}><ImagePanel src={frames[a]} index={a} audit={data[a]} activeMark={activeMark} guides={guides} setPoint={p=>mark(a,p)}/><ImagePanel src={frames[b]} index={b} audit={data[b]} activeMark={activeMark} guides={guides} setPoint={p=>mark(b,p)}/></div>
    <div className={styles.controls}><div><strong>COMPARE</strong><button type="button" data-active={mode==="overlay"||undefined} onClick={()=>setMode("overlay")}>Overlay</button><button type="button" data-active={mode==="blink"||undefined} onClick={()=>setMode("blink")}>Blink 500ms</button><button type="button" data-active={mirrorB||undefined} onClick={()=>setMirrorB(v=>!v)}>Mirror {String(b+1).padStart(2,"0")}</button></div><label>Frame B opacity <b>{opacity}%</b><input type="range" min="0" max="100" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label></div>
    <div className={styles.overlay}><img src={frames[a]} alt={`Frame ${a+1}`}/><img src={frames[b]} alt={`Frame ${b+1}`} style={{opacity:mode==="blink"?(blinkB?1:0):opacity/100,transform:mirrorB?"scaleX(-1)":undefined}}/>{guides.ground&&<i className={`${styles.guide} ${styles.ground}`}/>} {guides.center&&<i className={`${styles.guide} ${styles.center}`}/>}</div>
    <p className={styles.note}>Mirror is display-only. Assess body-pose symmetry separately from scarf-logo and facial identity details, which are expected to reverse.</p>
    <div className={styles.toggles}><strong>GUIDES</strong>{Object.entries({ground:"Ground line",center:"Vertical center",head:"Head center",body:"Body center",foot:"Foot guide"}).map(([key,label])=><label key={key}><input type="checkbox" checked={guides[key as keyof typeof guides]} onChange={()=>setGuides(v=>({...v,[key]:!v[key as keyof typeof guides]}))}/>{label}</label>)}</div>
    <div className={styles.landmarks}><div><strong>LANDMARK MODE</strong>{MARKS.map(([key,label])=><button type="button" key={key} data-active={activeMark===key||undefined} onClick={()=>setActiveMark(key)}>{label}</button>)}</div><p>Choose a landmark, then click either frame. State is local to this DEV component.</p><table><thead><tr><th>Landmark</th><th>Frame {String(a+1).padStart(2,"0")}</th><th>Frame {String(b+1).padStart(2,"0")}</th></tr></thead><tbody>{MARKS.map(([key,label])=><tr key={key}><th>{label} X/Y</th>{[a,b].map(i=><td key={i}>{data[i].marks[key]?`${pixel(data[i].marks[key]!.x)}, ${pixel(data[i].marks[key]!.y)} px`:"—"}</td>)}</tr>)}</tbody></table><div className={styles.errors}>{Object.entries(errors).map(([key,value])=><span key={key}>{key} symmetry error<strong>{displayError(value)}</strong></span>)}</div></div>
    <div className={styles.phases}><strong>PHASE &amp; GROUND CONTACT</strong>{data.map((v,i)=><div key={i}><b>{String(i+1).padStart(2,"0")}</b><select value={v.phase} onChange={e=>update(i,x=>({...x,phase:e.target.value as Phase}))}>{PHASES.map(p=><option key={p}>{p}</option>)}</select><label><input type="checkbox" checked={v.leftContact} onChange={()=>update(i,x=>({...x,leftContact:!x.leftContact}))}/>L contact</label><label><input type="checkbox" checked={v.rightContact} onChange={()=>update(i,x=>({...x,rightContact:!x.rightContact}))}/>R contact</label></div>)}</div>
    <div className={styles.charts}><Chart title="Foot X trajectory" lines={[{name:"Left foot",color:"var(--color-primary)",values:data.map(v=>v.marks.leftFoot?.x)},{name:"Right foot",color:"var(--color-accent)",values:data.map(v=>v.marks.rightFoot?.x)}]}/><Chart title="Body / Head Y" lines={[{name:"Body",color:"var(--color-primary)",values:data.map(v=>v.marks.body?.y)},{name:"Head",color:"var(--color-accent)",values:data.map(v=>v.marks.head?.y)}]}/></div>
    <div className={styles.summary}><strong>WALK AUDIT</strong>{checkLabels.map((label,i)=><label key={label}><input type="checkbox" checked={checks[i]} onChange={()=>setChecks(v=>v.map((x,n)=>n===i?!x:x))}/>{label}</label>)}</div>
  </section>;
}
