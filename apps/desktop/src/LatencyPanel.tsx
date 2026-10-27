import type {VoiceOutputStatus} from '../../../packages/contracts/voice-output.ts';
import {latencyFields,type LatencyTrace} from '../../../packages/contracts/latency.ts';
export function LatencyPanel({trace,voice}:{trace:LatencyTrace|null;voice?:VoiceOutputStatus}){
 const spans=trace?.spans??[],scale=Math.max(1,...spans.map(s=>s.endMs??s.startMs));
 return <details className="latency-profiler"><summary>Developer latency profiler</summary>
  <p className="panel-intro">{trace?`${trace.operation.replaceAll('_',' ')} · ${trace.state}`:'No measured operation yet. Voice previews will appear here.'}</p>
  <p className="panel-intro">Milliseconds per stage. Missing measurements stay blank. Latest attempt per stage; overlapping stages are not added together.</p>
  <dl>{latencyFields.map(field=>{const m=trace?.metrics[field];return <div key={field}><dt>{field}</dt><dd>{m?.ms==null?'—':`${m.ms} ms`} <small>{m?.state.replaceAll('_',' ')??'unavailable'}</small></dd></div>;})}</dl>
  {spans.length>0&&<><p className="eyebrow">ATTEMPT TIMELINE</p><ol>{spans.map(s=><li key={s.id}><span>{s.field} · {s.state}</span><div className="latency-track"><i style={{marginLeft:`${s.startMs/scale*100}%`,width:`${Math.max(.5,((s.endMs??s.startMs)-s.startMs)/scale*100)}%`}}/></div></li>)}</ol></>}
  {voice?.provider==='local'&&!!voice.preparation?.length&&<VoicePreparationTiming voice={voice}/>}
  {!!trace?.droppedSpans&&<p>Additional spans omitted: {trace.droppedSpans}</p>}
  <p className="panel-intro">Preview timing is not conversational response latency. UI presentation acknowledgement is not yet measured.</p>
 </details>;
}

function VoicePreparationTiming({voice}:{voice:VoiceOutputStatus}){
 const stages=voice.preparation??[],ready=stages.find(stage=>stage.stage==='ready');
 const names={model:'Model loading',acknowledgements:'Quick acknowledgements',warmup:'Readiness check',ready:'Ready'};
 const preparing=['PREPARING','STARTING'].includes(voice.state)&&!ready;
 return <section aria-label="Local voice preparation timing">
  <p className="eyebrow">LOCAL VOICE PREPARATION · {voice.localEngine==='piper'?'PIPER':'KOKORO'}</p>
  <p className="panel-intro">Latest preparation attempt. Measured inside the worker, before speech. These durations are separate from first-audio latency.</p>
  <dl>{stages.map((stage,index)=>stage.stage==='ready'?null:<div key={stage.stage}>
   <dt>{names[stage.stage]}</dt><dd>{stages[index+1]?`${Math.round(stages[index+1].elapsedMs-stage.elapsedMs)} ms`:preparing?'In progress':'Not completed'}</dd>
  </div>)}</dl>
  <p className="panel-intro">{ready?`Worker ready after ${Math.round(ready.elapsedMs)} ms. This excludes process launch overhead.`:'Preparation has not reported readiness. Unfinished stages have no measured duration.'}</p>
 </section>;
}
