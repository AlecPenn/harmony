import {useEffect,useState} from 'react';
import type {Scoreboard} from '../../../core/speed-scoreboard.ts';

/** The speed scoreboard: every build's real reply times against the targets, so each speed pass shows its effect. */
export function SpeedPanel({board}:{board?:Scoreboard}){
 if(!board)return null;
 const s=(ms:number|null|undefined)=>ms==null?'—':`${(ms/1000).toFixed(1)} s`;
 return <section className="speed-panel"><h3>Speed scoreboard</h3>
  <p className="panel-intro">{board.summary}</p>
  {!!board.builds.length&&<table><thead><tr><th>Build</th><th>Replies</th><th>Short reply<small>typical · slow end</small></th><th>Under 1.2 s</th><th>Lookup<small>first words</small></th><th>Start</th></tr></thead>
   <tbody>{[...board.builds].reverse().map(b=><tr key={b.build}><td><code>{b.build}</code><small>{new Date(b.to).toLocaleDateString([],{month:'short',day:'numeric'})}</small></td><td>{b.n}</td>
    <td>{s(b.kinds.brain?.median)} · {s(b.kinds.brain?.p90)}</td><td className={b.kinds.brain&&b.kinds.brain.met>=80?'met':''}>{b.kinds.brain?`${b.kinds.brain.met}%`:'—'}</td>
    <td>{s(b.kinds.lookup?.median)}</td><td>{s(b.startup.median)}</td></tr>)}</tbody></table>}
  <p className="panel-intro">Measured on this PC from real replies: milliseconds only, never words. Targets: commands under 0.5 s, short replies' first audio under 1.2 s, lookups' first words under 2.5 s, start under 5 s.</p>
 </section>;
}

/** Start with Windows: HARMONY loads quietly at sign-in, so opening her is instant. Off unless turned on here. */
export function StartupPanel(){
 const [s,setS]=useState<{atLogin:boolean;available:boolean}|null>(null);
 useEffect(()=>{void window.harmony?.startup({op:'get'}).then(setS,()=>{});},[]);
 if(!s?.available)return null;
 return <section className="speed-panel"><h3>Start with Windows</h3>
  <label className="setting"><input type="checkbox" checked={s.atLogin} onChange={e=>void window.harmony?.startup({op:'set',atLogin:e.target.checked}).then(setS,()=>{})}/>
   <span>Load HARMONY quietly when you sign in<small>She warms up in the background (no window), so opening her is instant instead of about 12 seconds. The orb shows she's running. While she's open she keeps several gigabytes of memory and part of the graphics card's memory in use.</small></span></label>
 </section>;
}
