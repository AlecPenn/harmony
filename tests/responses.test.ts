import {test,expect} from 'vitest';
import {ResponsesReasoner,type ReasoningRequest} from '../packages/reasoning/responses.ts';
const key='fixture_not_a_real_key';
const request=():ReasoningRequest=>({text:'Hello',cloudApproved:true,maxOutputTokens:128,signal:new AbortController().signal});
const done={type:'response.completed',sequence_number:9,response:{status:'completed',model:'gpt-6-astra',usage:{input_tokens:10,output_tokens:4}}};
const delta=(text='Hi',sequence_number=1)=>({type:'response.output_text.delta',sequence_number,delta:text});
const encode=(events:unknown[])=>events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('');
function fixture(text:string,split=7){
 const bytes=new TextEncoder().encode(text);let offset=0,cancelled=false;
 const body=new ReadableStream<Uint8Array>({pull(c){if(offset>=bytes.length){c.close();return;}c.enqueue(bytes.slice(offset,offset+split));offset+=split;},cancel(){cancelled=true;}});
 const transport:typeof fetch=async()=>new Response(body,{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
 return {reasoner:new ResponsesReasoner(transport),cancelled:()=>cancelled};
}
async function collect(reasoner:ResponsesReasoner,r=request()){const result=[];for await(const e of reasoner.stream(r,key))result.push(e);return result;}

test('streaming preserves fragmented Unicode and emits text before completion',async()=>{
 const f=fixture(encode([delta('Hello 🌌'),done]),1);const stream=f.reasoner.stream(request(),key);
 expect(await stream.next()).toEqual({done:false,value:{type:'text',text:'Hello 🌌'}});
 expect(await stream.next()).toEqual({done:false,value:{type:'completed',inputTokens:10,outputTokens:4}});
 expect((await stream.next()).done).toBe(true);
});
test('request uses fixed endpoint and model with no storage, tools or redirects',async()=>{
 let captured:RequestInit|undefined;
 const transport:typeof fetch=async(url,init)=>{expect(url).toBe('https://api.openai.com/v1/responses');captured=init;return new Response(encode([done]),{headers:{'Content-Type':'text/event-stream'}});};
 await collect(new ResponsesReasoner(transport));
 expect(captured?.redirect).toBe('error');expect(captured?.signal).toBeInstanceOf(AbortSignal);
 expect(JSON.parse(captured!.body as string)).toMatchObject({model:'gpt-6-astra',store:false,stream:true,tools:[],tool_choice:'none',max_output_tokens:128});
});
test('invalid consent, size or token budget never calls the transport',async()=>{
 let calls=0;const reasoner=new ResponsesReasoner(async()=>{calls++;throw new Error('should not call');});
 for(const patch of [{cloudApproved:false},{cloudApproved:'yes'},{text:'x'.repeat(8001)},{maxOutputTokens:Infinity},{maxOutputTokens:4097}]){
  await expect(collect(reasoner,{...request(),...patch} as ReasoningRequest)).rejects.toThrow('not authorized');
 }
 expect(calls).toBe(0);
});
test('truncation, incomplete status, duplicate sequence and invalid JSON fail closed',async()=>{
 for(const source of [encode([delta()]),encode([{type:'response.incomplete',sequence_number:1}]),encode([delta(),delta('again')]),'data: {bad}\n\n',encode([delta()])+'data: {}']){
  await expect(collect(fixture(source).reasoner)).rejects.toThrow('unavailable or incomplete');
 }
});
test('refusals are separate and reasoning/tool arguments are not promoted to text',async()=>{
 const f=fixture(encode([{type:'response.reasoning_text.delta',delta:'private',sequence_number:0},{type:'response.function_call_arguments.delta',delta:'delete',sequence_number:1},{type:'response.refusal.delta',delta:'Cannot help.',sequence_number:2},done]));
 expect(await collect(f.reasoner)).toEqual([{type:'refusal',text:'Cannot help.'},{type:'completed',inputTokens:10,outputTokens:4}]);
});
test('oversized events and accumulated text are rejected',async()=>{
 for(const source of ['data: '+ 'x'.repeat(128*1024),encode([delta('x'.repeat(20000),1),delta('x'.repeat(20000),2),done])])await expect(collect(fixture(source,4096).reasoner)).rejects.toThrow();
});
test('STOP cancels a pending read and never exposes the abort reason',async()=>{
 let cancelled=false,opened!:()=>void;const ready=new Promise<void>(resolve=>{opened=resolve;});
 const transport:typeof fetch=async()=>{opened();return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});};
 const controller=new AbortController();const result=collect(new ResponsesReasoner(transport),{...request(),signal:controller.signal});
 await ready;await new Promise(resolve=>setImmediate(resolve));controller.abort('private reason');
 await expect(result).rejects.toThrow(/^Reasoning cancelled$/);expect(cancelled).toBe(true);
});
test('consumer cancellation closes the stream without draining later text',async()=>{
 const f=fixture(encode([delta(),done]),1);for await(const event of f.reasoner.stream(request(),key)){expect(event.type).toBe('text');break;}
 expect(f.cancelled()).toBe(true);
});
test('provider and transport errors are redacted and never retried',async()=>{
 let calls=0;const transport:typeof fetch=async()=>{calls++;throw new Error('secret provider detail');};
 await expect(collect(new ResponsesReasoner(transport))).rejects.toThrow(/^Reasoning response unavailable or incomplete$/);expect(calls).toBe(1);
 const errorTransport:typeof fetch=async()=>new Response('secret',{status:429});
 await expect(collect(new ResponsesReasoner(errorTransport))).rejects.toThrow(/^Reasoning response unavailable or incomplete$/);
});
test('pre-cancelled requests make no network call',async()=>{
 let called=false;const c=new AbortController();c.abort();
 const reasoner=new ResponsesReasoner(async()=>{called=true;throw new Error();});
 await expect(collect(reasoner,{...request(),signal:c.signal})).rejects.toThrow('cancelled');expect(called).toBe(false);
});
