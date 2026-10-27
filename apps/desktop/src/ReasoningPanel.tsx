import type {ReasoningChoice} from '../../../packages/reasoning/selection.ts';
import {useEffect,useState} from 'react';
import type {ReasoningStatus} from '../../../packages/contracts/reasoning.ts';
export function ReasoningPanel({status,system}:{status?:ReasoningStatus;system:string}){
 const [model,setModel]=useState<ReasoningChoice>('gpt-6-astra');
 const [prompt,setPrompt]=useState(''),[configured,setConfigured]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
 useEffect(()=>{let active=true;window.harmony?.reasoningConnection().then(value=>{if(active)setConfigured(value.configured);}).catch(()=>{});return()=>{active=false;};},[]);
 async function action(kind:'review'|'approve'|'cancel'){
  setMessage('');setPending(true);try{
   if(kind==='review')await window.harmony!.reasoningReview(prompt,model);
   else if(kind==='approve'&&status?.reviewId)await window.harmony!.reasoningApprove(status.reviewId);
   else if(kind==='cancel')await window.harmony!.reasoningCancel();
  }catch{setMessage(model.startsWith('auto:')?'Automatic selection could not proceed. Check recent model use and the allowance, or choose a model manually.':'This request could not proceed. Check the saved connection or review it again.');}finally{setPending(false);}
 }
 const estimating=status?.state==='ESTIMATING',countReview=status?.state==='ESTIMATE_REVIEW',reviewing=status?.state==='REVIEW',streaming=status?.state==='STREAMING';
 return <section className="reasoning-panel"><h3>Optional cloud models · paid API</h3><p className="panel-intro">Choose a model or let HARMONY select one for your chosen task depth. Automatic selection requires recent successful use of that model. Review the model and exact text for a cost estimate, then approve the answer separately. The reviewed model never changes silently. No microphone audio, files or other context is included. This mode cannot run tools. Answers require an available local AI allowance; possible sends retain their reservation pending billing reconciliation.</p>
 {!configured&&<p className="panel-intro">Save your OpenAI API key and set up a local AI allowance in Settings first. API account access is separate from this app.</p>}
 {!reviewing&&!streaming&&!estimating&&!countReview&&<><label>Reasoning model<select aria-label="Reasoning model" value={model} disabled={system!=='PASSIVE'||pending} onChange={event=>setModel(event.target.value as ReasoningChoice)}><option value="auto:routine">Auto · routine tasks</option><option value="auto:complex">Auto · complex tasks</option><option value="auto:hardest">Auto · deepest reasoning</option><option value="gpt-6-luna">Luna · routine tasks</option><option value="gpt-6.1-sol">Sol · complex tasks</option><option value="gpt-6-astra">Astra · deepest reasoning</option></select></label><label>Your request<textarea aria-label="Your request to HARMONY" value={prompt} maxLength={8000} rows={4} disabled={system!=='PASSIVE'||pending} onChange={event=>setPrompt(event.target.value)}/></label><button className="text-button" disabled={!configured||!prompt.trim()||system!=='PASSIVE'||pending} onClick={()=>void action('review')}>Review cloud request</button></>}
 {countReview&&<div className="reasoning-review"><h4>Review before estimating</h4><p>Selected model: {status.modelId}</p>{status.automatic&&<p>Automatically selected for {status.automatic==='hardest'?'deepest':status.automatic} reasoning. Readiness and allowance are checked again before sending.</p>}<p className="reasoning-output">{status.prompt}</p><p className="panel-intro">Send this text and HARMONY's fixed instructions to OpenAI to count the input and estimate model cost. This does not request an answer. Provider terms apply. You will review the estimate before approving generation. This review expires after one minute.</p><button className="primary" disabled={pending} onClick={()=>void action('approve')}>Send for cost estimate</button></div>}
 {estimating&&<p role="status">Getting the input count and cost estimate…</p>}
 {reviewing&&status.estimate&&<p className="panel-intro" aria-label="Estimated model cost">Estimated model cost up to USD {(status.estimate.ceilingMicros/1000000).toFixed(6)} for {status.estimate.inputTokens} input tokens and at most 1,024 output tokens. HARMONY must reserve this estimate from your local allowance before sending. It is not an invoice or an OpenAI account spending limit.</p>}
 {reviewing&&<div className="reasoning-review"><h4>Review before sending</h4><p className="reasoning-output">{status.prompt}</p><p className="panel-intro">Send this text to OpenAI using {status.modelId}. OpenAI API charges may apply. Limit: 1,024 output tokens, including reasoning. This review expires after one minute.</p><button className="primary" disabled={pending} onClick={()=>void action('approve')}>Approve and send to OpenAI</button></div>}
 {(reviewing||streaming||countReview||estimating)&&<button className="text-button" disabled={pending} onClick={()=>void action('cancel')}>Cancel reasoning request</button>}
 {streaming&&<p role="status">{status.text?'Receiving response…':'Waiting for the first response…'}</p>}
 {status?.routingTrace?.metrics.model_router_ms.state==='completed'&&<p className="panel-intro">Model selection check: {status.routingTrace.metrics.model_router_ms.ms} ms</p>}
 {!!status?.text&&<div className="reasoning-output" aria-label="HARMONY response">{status.text}</div>}
 {status?.state==='FINISHED'&&<p role="status">{status.refused?'Response complete · request declined':'Response complete'}</p>}
 {status?.error&&<p role="alert">{status.error}</p>}
 {status?.trace?.metrics.llm_first_token_ms.state==='completed'&&<p className="panel-intro">First response text: {status.trace.metrics.llm_first_token_ms.ms} ms</p>}
 {status?.usage&&<p className="panel-intro">Reported usage: {status.usage.inputTokens} input / {status.usage.outputTokens} output tokens.</p>}
 {!!status?.text&&!streaming&&<button className="text-button" onClick={()=>void action('cancel')}>Clear response</button>}
 {message&&<p role="alert">{message}</p>}</section>;
}
