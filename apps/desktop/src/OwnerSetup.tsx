import {useEffect,useState} from 'react';
export function OwnerSetup({disabled}:{disabled:boolean}){
 const [status,setStatus]=useState<{configured:boolean;available:boolean}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;window.harmony?.ownerStatus().then(value=>{if(active)setStatus(value);},()=>{if(active)setMessage('Owner verification is unavailable.');});return()=>{active=false;};},[]);
 async function enroll(){setBusy(true);setMessage('');try{await window.harmony!.ownerEnroll();setStatus(await window.harmony!.ownerStatus());setMessage('Local owner credential saved. No spending allowance was created.');}catch{setMessage('Owner enrollment did not finish. Nothing was unlocked.');}finally{setBusy(false);}}
 return <section className="voice-setup"><h3>Local owner verification</h3><p className="panel-intro">Create a HARMONY owner credential using Windows verification. Windows handles your PIN or biometrics; HARMONY keeps only the public credential, protected on this computer. Voice recognition cannot replace this check.</p>
 <p role="status">{status?.configured?'Owner credential saved':status?.available?'Windows verification API available · setup not yet checked':'Windows verification unavailable'}</p>
 {!status?.configured&&<><p className="panel-intro">The next button opens Windows setup. You must complete it yourself. This establishes the local owner for this Windows profile, not a household speaker identity. It does not create a budget or send a cloud request.</p><button className="text-button" disabled={disabled||busy||!status?.available} onClick={()=>void enroll()}>{busy?'Waiting for Windows verification…':'Set up local owner'}</button></>}
 {message&&<p role="status">{message}</p>}</section>;
}
