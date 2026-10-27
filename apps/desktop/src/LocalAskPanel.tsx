import {SourceList} from './SourceList.tsx';
import {useState} from 'react';
import type {LocalReasoningStatus} from '../../../packages/contracts/local-reasoning.ts';

const modelLine=(status?:LocalReasoningStatus)=>{
 const model=status?.model;
 if(!model||model.state==='NOT_INSTALLED')return 'Not installed yet. Run “Set up local brain” from the HARMONY folder once, then ask here.';
 const name=model.modelName??'Local model';
 switch(model.state){
  case 'READY':return `${name} · loaded on this PC`;
  case 'STARTING':return `${name} · loading…`;
  case 'STOPPING':return `${name} · unloading…`;
  case 'FAILED':return `${name} · could not run. Try again, or rerun the local brain check.`;
  default:return `${name} · loads when you ask (unloads after 10 idle minutes)`;
 }
};

/** Free, private typed requests. Nothing leaves this computer, so there is no cost review. */
export function LocalAskPanel({status,system}:{status?:LocalReasoningStatus;system:string}){
 const [prompt,setPrompt]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
 const working=status?.state==='STARTING'||status?.state==='STREAMING';
 const installed=!!status&&status.model.state!=='NOT_INSTALLED';
 async function action(kind:'ask'|'cancel'|'clear'){
  setMessage('');setPending(true);
  try{
   if(kind==='ask')await window.harmony!.localAsk(prompt);
   else if(kind==='cancel')await window.harmony!.localCancel();
   else await window.harmony!.localClear();
  }catch{setMessage('HARMONY could not take that request right now. Wait for other work to finish, then try again.');}
  finally{setPending(false);}
 }
 const first=status?.trace?.metrics.llm_first_token_ms;
 return <section className="reasoning-panel local-ask"><h3>Ask HARMONY · free on this PC</h3>
  <p className="panel-intro">Runs privately on your computer. No account, no cost and nothing is sent online. It can't use tools, files or the microphone yet.</p>
  <p className="panel-intro" aria-label="Local model status">{modelLine(status)}</p>
  {!working&&<><label>Your request<textarea aria-label="Your request to local HARMONY" value={prompt} maxLength={8000} rows={3} disabled={system!=='PASSIVE'||pending} onChange={event=>setPrompt(event.target.value)}/></label>
   <button className="primary" disabled={!installed||!prompt.trim()||system!=='PASSIVE'||pending} onClick={()=>void action('ask')}>Ask</button></>}
  {working&&<><p role="status">{status?.state==='STARTING'?'Loading the local model…':status?.text?'Answering…':'Thinking…'}</p><button className="text-button" disabled={pending} onClick={()=>void action('cancel')}>Stop answer</button></>}
  {!!status?.text&&<div className="reasoning-output" aria-label="Local HARMONY response">{status.text}</div>}
  <SourceList sources={status?.sources}/>
  {status?.state==='FINISHED'&&<p role="status">{status.truncated?'Answer reached the length limit':'Answer complete'}</p>}
  {status?.state==='CANCELLED'&&!!status.text&&<p role="status">Answer stopped</p>}
  {status?.error&&<p role="alert">{status.error}</p>}
  {(first?.state==='completed'||status?.coldStartMs!=null)&&<p className="panel-intro">{status?.coldStartMs!=null&&<>Model load: {(status.coldStartMs/1000).toFixed(1)} s · </>}{first?.state==='completed'&&<>First words: {first.ms} ms</>}</p>}
  {!!status?.text&&!working&&<button className="text-button" disabled={pending} onClick={()=>void action('clear')}>Clear answer</button>}
  {message&&<p role="alert">{message}</p>}
 </section>;
}
