import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {latencyFields,type LatencyTrace} from '../packages/contracts/latency.ts';
import type {TurnContext} from '../packages/contracts/events.ts';
import {ActionApprovals,type ApprovalAuthority,type ApprovalTicket} from '../packages/permissions/approvals.ts';
import type {ProposedAction,ToolPolicy} from '../packages/permissions/policy.ts';
import {ResponsesReasoner,type ReasoningEvent} from '../packages/reasoning/responses.ts';

/** A permission proposal only, never registered as a general model-executable tool. */
export const reasoningPolicy:ToolPolicy=Object.freeze({id:'reasoning.openai.text',version:1,risk:'CONFIRM',permissions:Object.freeze(['cloud_reasoning'])});
export function reasoningProposal(personId:string,text:string,maxOutputTokens:number):ProposedAction{
  if(typeof text!=='string'||!text.trim()||text.length>8000||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<16||maxOutputTokens>4096)throw new Error('Invalid reasoning proposal');
  return {personId,toolId:reasoningPolicy.id,inputs:{text,maxOutputTokens,model:'gpt-6-astra',requestVersion:1}};
}
/** Trusted core entry. The human-review adapter owns approval; models and renderers cannot mint it. */
export class ApprovedReasoning {
  constructor(private approvals:ActionApprovals,private authority:ApprovalAuthority,
    private readKey:()=>Promise<string|null>,private provider:ResponsesReasoner=new ResponsesReasoner(),
    private diagnostics?:{publish:(trace:LatencyTrace)=>unknown;clock?:()=>number}){}
  async *stream(ticket:ApprovalTicket,proposal:ProposedAction,turn:TurnContext,signal:AbortSignal):AsyncGenerator<ReasoningEvent>{
    if(signal.aborted)throw new Error('Reasoning cancelled');
    const reviewed=this.approvals.consume(ticket,proposal,turn);
    if(!reviewed||reviewed.action.toolId!==reasoningPolicy.id||reviewed.toolVersion!==reasoningPolicy.version)throw new Error('Reasoning approval expired or denied');
    const inputs=reviewed.action.inputs as Record<string,unknown>;
    if(!inputs||Object.keys(inputs).sort().join(',')!=='maxOutputTokens,model,requestVersion,text'||inputs.model!=='gpt-6-astra'||inputs.requestVersion!==1)throw new Error('Invalid reasoning approval');
    const clean=reasoningProposal(reviewed.action.personId,inputs.text as string,inputs.maxOutputTokens as number).inputs as {text:string;maxOutputTokens:number};
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(120000)]);
    const current=()=>!combined.aborted&&this.authority.isCurrent(turn)&&this.authority.identifies(reviewed.action.personId,turn);
    const profiler=new LatencyProfiler(this.diagnostics?.clock);profiler.begin('reasoning');
    for(const field of latencyFields)if(field!=='llm_first_token_ms'&&field!=='full_turn_ms')profiler.notApplicable(field);
    const publish=()=>{try{const trace=profiler.snapshot();if(trace)Promise.resolve(this.diagnostics?.publish(trace)).catch(()=>{});}catch{}};
    let outcome:'completed'|'failed'|'cancelled'='cancelled',first=true;
    publish();
    try{
      if(!current())throw new Error();
      const key=await new Promise<string|null>((resolve,reject)=>{
        const abort=()=>reject(new Error('Cancelled'));
        combined.addEventListener('abort',abort,{once:true});
        Promise.resolve().then(()=>{combined.throwIfAborted();return this.readKey();}).then(resolve,reject).finally(()=>combined.removeEventListener('abort',abort));
      });
      // Credential loading must not let cancelled or revoked requests cross the network boundary.
      if(!current()||!key)throw new Error();
      const firstToken=profiler.start('llm_first_token_ms');
      for await(const event of this.provider.stream({...clean,cloudApproved:true,signal:combined},key)){
        if(!current())throw new Error();
        if(first&&(event.type==='text'||event.type==='refusal')&&event.text){first=false;profiler.end(firstToken);publish();}
        if(event.type==='completed')outcome='completed';
        yield event;
        if(!current())throw new Error();
      }
    }catch{outcome=!current()?'cancelled':'failed';throw new Error(outcome==='cancelled'?'Reasoning cancelled':'Approved reasoning did not complete');}
    finally{controller.abort();profiler.finish(outcome);publish();}
  }
}
