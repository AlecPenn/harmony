import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {latencyFields,type LatencyField,type LatencyTrace,type SpanState} from '../contracts/latency.ts';
/** One process owns all timestamps. Bounded diagnostics only; no payload metadata. */
export class LatencyProfiler {
  #trace:LatencyTrace|null=null;#origin=0;#last=0;#next=0;
  constructor(private clock:()=>number=()=>performance.now()){}
  #time(){const value=this.clock();if(!Number.isFinite(value)||value<this.#last)throw new Error('Invalid monotonic clock');this.#last=value;return value;}
  begin(operation:LatencyTrace['operation']){
    if(!['voice_preview','conversation','local_check','tool','reasoning'].includes(operation))throw new Error('Invalid operation');
    this.#origin=this.#time();this.#next=0;
    this.#trace={version:2,id:randomUUID(),operation,state:'pending',metrics:Object.fromEntries(latencyFields.map(field=>[field,{ms:null,state:'unavailable'}])) as LatencyTrace['metrics'],spans:[],droppedSpans:0};
    this.#trace.metrics.full_turn_ms={ms:null,state:'pending'};return this.#trace.id;
  }
  notApplicable(field:LatencyField){if(!this.#trace||this.#trace.state!=='pending'||field==='full_turn_ms'||!latencyFields.includes(field))return;this.#trace.metrics[field]={ms:null,state:'not_applicable'};}
  start(field:LatencyField){
    const t=this.#trace;if(!t||t.state!=='pending'||field==='full_turn_ms'||!latencyFields.includes(field))return null;
    if(t.spans.length>=64){t.droppedSpans++;return null;}
    const span={id:++this.#next,field,startMs:this.#time()-this.#origin,endMs:null,state:'pending' as const};
    t.spans.push(span);t.metrics[field]={ms:null,state:'pending'};return {traceId:t.id,spanId:span.id};
  }
  end(token:{traceId:string;spanId:number}|null,state:'completed'|'failed'|'cancelled'='completed'){
    const t=this.#trace;if(!token||!t||t.id!==token.traceId||t.state!=='pending'||!['completed','failed','cancelled'].includes(state))return false;
    const span=t.spans.find(s=>s.id===token.spanId);if(!span||span.state!=='pending')return false;
    span.endMs=this.#time()-this.#origin;span.state=state;
    // Summary is the most recently started attempt; all attempts remain in the timeline.
    if(!t.spans.some(s=>s.field===span.field&&s.id>span.id))t.metrics[span.field]={ms:Math.round((span.endMs-span.startMs)*100)/100,state};return true;
  }
  finish(state:'completed'|'failed'|'cancelled'){
    const t=this.#trace;if(!t||t.state!=='pending')return;
    if(!['completed','failed','cancelled'].includes(state))throw new Error('Invalid outcome');
    const end=this.#time()-this.#origin;
    for(const span of t.spans.filter(s=>s.state==='pending')){span.endMs=end;span.state=state==='completed'?'failed':state;if(!t.spans.some(s=>s.field===span.field&&s.id>span.id))t.metrics[span.field]={ms:Math.round((end-span.startMs)*100)/100,state:span.state};}
    t.state=state;t.metrics.full_turn_ms={ms:Math.round(end*100)/100,state};
  }
  snapshot():LatencyTrace|null{return this.#trace?structuredClone(this.#trace):null;}
}
