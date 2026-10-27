import {useEffect,useState} from 'react';
import {australianVoices,type VoiceConnectionStatus} from '../../../packages/contracts/voice-connection.ts';
export function VoiceSetup({busy,onConfigured}:{busy:boolean;onConfigured:(ready:boolean)=>void}){
  const [status,setStatus]=useState<VoiceConnectionStatus|null>(null),[region,setRegion]=useState(''),[key,setKey]=useState(''),[voice,setVoice]=useState<typeof australianVoices[number]>('en-AU-NatashaNeural'),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  useEffect(()=>{let active=true;window.harmony?.voiceConnection().then(value=>{if(active){setStatus(value);setRegion(value.region);setVoice(value.voice as typeof voice);onConfigured(value.configured);}}).catch(()=>{if(active)setMessage('Protected speech settings are unavailable.');});return()=>{active=false;};},[onConfigured]);
  async function save(){setSaving(true);setMessage('');try{await window.harmony!.voiceConfigure({region:region.trim(),key:key.trim(),voice});setKey('');const next=await window.harmony!.voiceConnection();setStatus(next);onConfigured(next.configured);setMessage('Saved securely. Preview to verify the connection.');}catch{setMessage('Could not save. Check the region and key.');}finally{setSaving(false);}}
  async function forget(){setSaving(true);try{await window.harmony!.voiceForget();setStatus({configured:false,region:'',voice:'en-AU-NatashaNeural'});setKey('');onConfigured(false);setMessage('Saved connection removed.');}catch{setMessage('Could not remove the connection.');}finally{setSaving(false);}}
  return <details className="voice-setup" open={!status?.configured}>
    <summary>{status?.configured?'Azure Speech saved · change connection':'Set up Azure Speech'}</summary>
    <p className="panel-intro">Create an Azure Speech resource, then enter its region and key here. Saving stays local; a preview sends only the sample script. Keys are protected by Windows.</p>
    <label>Region<input aria-label="Azure Speech region" value={region} maxLength={40} placeholder="For example, eastus" autoComplete="off" disabled={busy||saving} onChange={e=>setRegion(e.target.value)}/></label>
    <label>Speech key<input aria-label="Azure Speech key" type="password" value={key} maxLength={128} autoComplete="new-password" placeholder={status?.configured?'Enter key to update connection':'Paste key here, not in chat'} disabled={busy||saving} onChange={e=>setKey(e.target.value)}/></label>
    <label>Australian female voice<select aria-label="Australian female voice" value={voice} disabled={busy||saving} onChange={e=>setVoice(e.target.value as typeof voice)}>{australianVoices.map(id=><option key={id} value={id}>{id.replace('en-AU-','').replace('Neural','')}</option>)}</select></label>
    <button className="text-button" disabled={busy||saving||!key.trim()||!region.trim()} onClick={()=>void save()}>Save speech connection</button>
    {status?.configured&&<button className="text-button" disabled={busy||saving} onClick={()=>void forget()}>Remove saved connection</button>}
    {message&&<p className="panel-intro" role="status">{message}</p>}
  </details>;
}
