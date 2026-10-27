import {useState} from 'react';
import type {DesktopStatus} from '../../../core/desktop.ts';

const time=(iso:string)=>new Date(iso).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});

/** Screen awareness and computer control settings. Looking happens only when asked; screenshots are never kept. */
export function ScreenControlPanel({status}:{status?:DesktopStatus}){
 const [busy,setBusy]=useState(false),[note,setNote]=useState('');
 if(!status)return null;
 async function set(value:{screen?:'off'|'on-demand'|'watch';control?:boolean}){setBusy(true);setNote('');try{await window.harmony!.desktopSettings(value);}catch{setNote('That setting could not be changed.');}finally{setBusy(false);}}
 return <section className="screen-control">
  <h3>Screen and computer control</h3>
  {!status.available?<p className="panel-intro">These work on Windows only.</p>:<>
   <label className="setting"><span>Look at my screen</span>
    <select aria-label="Look at my screen" value={status.screen} disabled={busy} onChange={e=>void set({screen:e.target.value as 'off'|'on-demand'|'watch'})}>
     <option value="on-demand">Only when I ask (“Harmony, look”)</option><option value="watch">Also watch for new errors every 2 minutes</option><option value="off">Never</option>
    </select></label>
   <p className="panel-intro">She reads the app window you're using (not HARMONY's) with Windows' own text recognition, answers, and throws the screenshot away. She always says “Looking.” first. Watching reads the window every 2 minutes and only shows a notice when a new error appears; nothing is kept.
    {status.lastLook?` Last look: ${time(status.lastLook.at)}, ${status.lastLook.app||'an app'}.`:''}</p>
   <label className="setting"><input type="checkbox" checked={status.control} disabled={busy} onChange={e=>void set({control:e.target.checked})}/>
    <span>Let HARMONY open apps and websites, switch windows, and control music and volume</span></label>
   <p className="panel-intro">Nothing else: she can't type, click, delete or buy anything. Each action shows in Activity, and STOP halts it.</p>
  </>}
  {note&&<p className="panel-intro" role="alert">{note}</p>}
 </section>;
}
