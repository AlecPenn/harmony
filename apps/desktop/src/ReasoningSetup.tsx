import {useEffect,useState} from 'react';
import type {ReasoningConnectionStatus} from '../../../packages/contracts/reasoning-connection.ts';
export function ReasoningSetup({disabled}:{disabled:boolean}){
 const [status,setStatus]=useState<ReasoningConnectionStatus|null>(null),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;window.harmony?.reasoningConnection().then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setMessage('Protected reasoning settings are unavailable.');});return()=>{active=false;};},[]);
 async function save(){setBusy(true);setMessage('');try{await window.harmony!.reasoningConfigure({key:key.trim()});setKey('');setStatus(await window.harmony!.reasoningConnection());setMessage('Key saved on this computer. No request was sent.');}catch{setKey('');setMessage('Could not save the key. Check the connection settings and try again.');}finally{setBusy(false);}}
 async function forget(){setBusy(true);setMessage('');try{await window.harmony!.reasoningForget();setKey('');setStatus(await window.harmony!.reasoningConnection());setMessage('Saved OpenAI key removed.');}catch{setMessage('Could not remove the saved key.');}finally{setBusy(false);}}
 return <section className="voice-setup"><h3>AI reasoning connection</h3><p className="panel-intro">Optional OpenAI API setup. The key is protected by Windows and stays separate from speech settings. Saving sends no request and does not verify account access. Review each typed request in System before sending it. Microphone conversation is not connected.</p>
 <p role="status">{status?.configured?'Key saved · account access unverified':'No OpenAI key saved'}</p>
 <label>OpenAI API key<input aria-label="OpenAI API key" type="password" value={key} maxLength={512} autoComplete="new-password" placeholder="Paste key here, not in chat" disabled={disabled||busy} onChange={event=>setKey(event.target.value)}/></label>
 <button className="text-button" disabled={disabled||busy||!key.trim()} onClick={()=>void save()}>Save OpenAI key locally</button>
 {status?.configured&&<button className="text-button" disabled={busy} onClick={()=>void forget()}>Remove saved OpenAI key</button>}
 {message&&<p className="panel-intro" role="status">{message}</p>}</section>;
}
