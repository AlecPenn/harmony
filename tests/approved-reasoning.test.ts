import {test,expect} from 'vitest';
import {ApplicationEventBus} from '../core/application-events.ts';
import {ApprovedReasoning,reasoningPolicy,reasoningProposal} from '../core/approved-reasoning.ts';
import {ActionApprovals} from '../packages/permissions/approvals.ts';
import {PermissionPolicy} from '../packages/permissions/policy.ts';
import {ResponsesReasoner} from '../packages/reasoning/responses.ts';
function fixture(){
 const bus=new ApplicationEventBus(),turn=bus.beginTurn();let identified=true,calls=0,keyReads=0;
 const authority={isCurrent:(t:typeof turn)=>bus.isCurrent(t),identifies:(person:string)=>identified&&person==='owner'};
 const policy=new PermissionPolicy([reasoningPolicy],[{id:'owner',permissions:['cloud_reasoning']}],{denyTools:[],lowRiskWriteTools:[]});
 const approvals=new ActionApprovals(()=>policy,authority);
 const provider=new ResponsesReasoner(async()=>{calls++;return new Response('data: '+JSON.stringify({type:'response.output_text.delta',sequence_number:1,delta:'Hi'})+'\n\ndata: '+JSON.stringify({type:'response.completed',sequence_number:2,response:{status:'completed',model:'gpt-6-astra',usage:{input_tokens:1,output_tokens:1}}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});});
 const readKey=async()=>{keyReads++;return 'fixture_not_a_real_key';};
 const runner=new ApprovedReasoning(approvals,authority,readKey,provider);
 const proposal=reasoningProposal('owner','Hello',128),ticket=approvals.request(proposal,turn)!;
 return {bus,turn,authority,approvals,provider,runner,proposal,ticket,counts:()=>({calls,keyReads}),revoke:()=>{identified=false;}};
}
async function collect(stream:AsyncIterable<unknown>){const output=[];for await(const value of stream)output.push(value);return output;}
const signal=()=>new AbortController().signal;
test('one exact approved prompt reaches the provider once',async()=>{
 const f=fixture();expect(f.approvals.approve(f.ticket)).toBe(true);
 expect(await collect(f.runner.stream(f.ticket,f.proposal,f.turn,signal()))).toHaveLength(2);
 await expect(collect(f.runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow('denied');
 expect(f.counts()).toEqual({calls:1,keyReads:1});
});
test('unapproved, copied, mutated and cancelled tickets cannot load credentials',async()=>{
 for(const change of ['unapproved','copied','prompt','budget','person','stop','identity']){
  const f=fixture();if(change!=='unapproved')f.approvals.approve(f.ticket);
  let ticket=f.ticket;
  if(change==='copied')ticket={...ticket};if(change==='prompt')(f.proposal.inputs as any).text='Changed';
  if(change==='budget')(f.proposal.inputs as any).maxOutputTokens=4096;
  if(change==='person')f.proposal.personId='other';if(change==='stop')f.bus.cancelAll();if(change==='identity')f.revoke();
  await expect(collect(f.runner.stream(ticket,f.proposal,f.turn,signal()))).rejects.toThrow();
  expect(f.counts()).toEqual({calls:0,keyReads:0});
 }
});
test('STOP during credential loading makes no provider request',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);let release!:(key:string)=>void;
 const runner=new ApprovedReasoning(f.approvals,f.authority,()=>new Promise(resolve=>{release=resolve;}),f.provider);
 const pending=collect(runner.stream(f.ticket,f.proposal,f.turn,signal()));
 await new Promise(resolve=>setImmediate(resolve));f.bus.cancelAll();release('fixture_not_a_real_key');await expect(pending).rejects.toThrow('cancelled');expect(f.counts().calls).toBe(0);
});
test('revocation after a text chunk blocks remaining output and completion',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);const stream=f.runner.stream(f.ticket,f.proposal,f.turn,signal());
 expect((await stream.next()).value).toEqual({type:'text',text:'Hi'});f.revoke();
 await expect(stream.next()).rejects.toThrow('cancelled');
});
test('credential errors are redacted and consume approval without retry',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);
 const runner=new ApprovedReasoning(f.approvals,f.authority,async()=>{throw new Error('private path and key');},f.provider);
 await expect(collect(runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow(/^Approved reasoning did not complete$/);
 await expect(collect(runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow('denied');expect(f.counts().calls).toBe(0);
});


test('first-token timing excludes credential loading but full request timing includes it',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);let now=10;const traces:import('../packages/contracts/latency.ts').LatencyTrace[]=[];
 const provider=new ResponsesReasoner(async()=>{now=70;return new Response('data: '+JSON.stringify({type:'response.output_text.delta',sequence_number:1,delta:'Hi'})+'\n\ndata: '+JSON.stringify({type:'response.completed',sequence_number:2,response:{status:'completed',model:'gpt-6-astra',usage:{input_tokens:1,output_tokens:1}}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});});
 const runner=new ApprovedReasoning(f.approvals,f.authority,async()=>{now=30;return 'fixture_not_a_real_key';},provider,{clock:()=>now,publish:t=>{traces.push(t);}});
 await collect(runner.stream(f.ticket,f.proposal,f.turn,signal()));const final=traces.at(-1)!;
 expect(final.operation).toBe('reasoning');expect(final.state).toBe('completed');
 expect(final.metrics.llm_first_token_ms).toEqual({ms:40,state:'completed'});
 expect(final.metrics.full_turn_ms).toEqual({ms:60,state:'completed'});
 expect(final.metrics.tts_first_audio_ms).toEqual({ms:null,state:'not_applicable'});
 expect(JSON.stringify(traces)).not.toContain('Hello');expect(traces).toHaveLength(3);
});
test('consumer interruption marks timing cancelled and throwing observers cannot break the stream',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);const traces:import('../packages/contracts/latency.ts').LatencyTrace[]=[];
 const runner=new ApprovedReasoning(f.approvals,f.authority,async()=>'fixture_not_a_real_key',f.provider,{publish:t=>{traces.push(t);throw new Error('observer');}});
 for await(const event of runner.stream(f.ticket,f.proposal,f.turn,signal())){expect(event.type).toBe('text');break;}
 expect(traces.at(-1)?.state).toBe('cancelled');expect(traces.at(-1)?.metrics.llm_first_token_ms.state).toBe('completed');
});
test('credential failure leaves first-token latency unavailable, never zero',async()=>{
 const f=fixture();f.approvals.approve(f.ticket);const traces:import('../packages/contracts/latency.ts').LatencyTrace[]=[];
 const runner=new ApprovedReasoning(f.approvals,f.authority,async()=>null,f.provider,{publish:t=>{traces.push(t);}});
 await expect(collect(runner.stream(f.ticket,f.proposal,f.turn,signal()))).rejects.toThrow();
 expect(traces.at(-1)?.state).toBe('failed');expect(traces.at(-1)?.metrics.llm_first_token_ms).toEqual({ms:null,state:'unavailable'});
});
