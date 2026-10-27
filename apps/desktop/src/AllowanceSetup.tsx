import {useState} from 'react';
import type {Snapshot} from '../../../packages/contracts/index.ts';
export function AllowanceSetup({status,system}:{status:Snapshot['allowance'];system:string}){
 const [amount,setAmount]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
 const review=status?.state==='REVIEW',verifying=status?.state==='VERIFYING';
 const money=(value:number)=>(value/1000000).toFixed(6);
 async function action(kind:'review'|'approve'|'cancel'){
  setMessage('');setPending(true);try{
   if(kind==='review')await window.harmony!.allowanceReview(amount);
   if(kind==='approve'&&status?.reviewId)await window.harmony!.allowanceApprove(status.reviewId);
   if(kind==='cancel')await window.harmony!.allowanceCancel();
  }catch{setMessage('This allowance action could not proceed. Enter a USD amount with at most two decimal places, or review again.');}finally{setPending(false);}
 }
 return <section className="voice-setup"><h3>Local AI allowance</h3>
 <p className="panel-intro">A fixed allowance for this Windows profile's typed AI answers. Set up local owner verification above first. This does not change your OpenAI account limits or cover spending from other apps.</p>
 {status?.balance?<p aria-label="Local allowance balance">USD {money(status.balance.remainingMicros)} available of {money(status.balance.limitMicros)}. Reserved or spent: {money(status.balance.committedMicros)}.</p>:<p>No local allowance available.</p>}
 {status?.balance&&<dl aria-label="Allowance breakdown"><dt>Waiting to send</dt><dd>USD {money(status.balance.waitingMicros)}</dd><dt>Awaiting billing confirmation</dt><dd>USD {money(status.balance.uncertainMicros)} · {status.balance.unresolvedCount} requests</dd><dt>Confirmed charges</dt><dd>USD {money(status.balance.settledMicros)}</dd></dl>}
 <p className="panel-intro">Possible sends keep their estimated amount reserved until billing reconciliation is available. STOP does not refund them. This allowance does not reset automatically and cannot currently be increased.</p>
 {!review&&!verifying&&!status?.balance&&<><label>Allowance in USD<input aria-label="Allowance in USD" inputMode="decimal" value={amount} maxLength={13} disabled={pending||system!=='PASSIVE'} onChange={event=>setAmount(event.target.value)}/></label><button className="text-button" disabled={!amount||pending||system!=='PASSIVE'} onClick={()=>void action('review')}>Review allowance</button></>}
 {review&&<><h4>Review local allowance</h4><p>Establish USD {money(status.limitMicros!)} for this local Windows profile. Approving opens Windows verification for this exact amount. No money is charged by creating the allowance. Review expires after one minute.</p><button className="primary" disabled={pending||system!=='ACTIVE'} onClick={()=>void action('approve')}>Verify owner and create allowance</button></>}
 {(review||verifying)&&<button className="text-button" onClick={()=>void action('cancel')}>Cancel allowance</button>}
 {verifying&&<p role="status">Waiting for Windows owner verification…</p>}
 {status?.balance&&<details><summary>Recent AI requests</summary><p className="panel-intro">Up to 20 requests, newest created first. These local references are not provider receipts. Prompts are not stored in this history.</p>
 {status.history==null?<p>Request history unavailable.</p>:status.history.length===0?<p>No requests recorded.</p>:<ol aria-label="Allowance request history">{status.history.map(entry=><li key={entry.reference}><p><strong>{entry.model}</strong> · {{RESERVED:'Waiting to send',DISPATCHED:'Send attempted · charge unconfirmed',UNCERTAIN:'Awaiting billing confirmation',SETTLED:'Confirmed charge',RELEASED:'Released before sending'}[entry.state]}</p><p>{entry.state==='SETTLED'?'Charge':'Estimated maximum'}: USD {money(entry.state==='SETTLED'?entry.actualMicros!:entry.ceilingMicros)}</p><small>Local reference: {entry.reference}</small></li>)}</ol>}
 </details>}
 {status?.state==='CREATED'&&<p role="status">Local allowance saved. Each AI request still needs separate approval.</p>}
 {status?.error&&<p role="alert">{status.error}</p>}{message&&<p role="alert">{message}</p>}
 </section>;
}
