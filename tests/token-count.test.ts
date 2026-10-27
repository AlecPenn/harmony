import {test,expect,vi,afterEach} from 'vitest';
import {ResponsesTokenCounter} from '../packages/reasoning/token-count.ts';
import {ResponsesReasoner} from '../packages/reasoning/responses.ts';
import {textInputHash} from '../packages/reasoning/text-contract.ts';
const key='test_protected_key_12345';
const request=()=>({text:'Private prompt',cloudApproved:true,signal:new AbortController().signal});
const reply=(body:unknown={object:'response.input_tokens',input_tokens:51})=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
afterEach(()=>vi.useRealTimers());
test('count and generation share the entire input contract and bind the immutable result',async()=>{
 let counted:Record<string,unknown>={},generated:Record<string,unknown>={};
 const transport=vi.fn<typeof fetch>(async(url,init)=>{expect(url).toBe('https://api.openai.com/v1/responses/input_tokens');expect(init?.redirect).toBe('error');counted=JSON.parse(init?.body as string);return reply();});
 const result=await new ResponsesTokenCounter(transport).count(request(),key);
 const reasoner=new ResponsesReasoner(async(_url,init)=>{generated=JSON.parse(init?.body as string);return new Response('',{status:503});});
 await expect(reasoner.stream({...request(),maxOutputTokens:1024},key).next()).rejects.toThrow();
 const {stream,store,max_output_tokens,...generationInput}=generated;
 expect(counted).toEqual(generationInput);expect(counted.instructions).toContain('You are HARMONY');
 expect(result).toEqual({inputHash:textInputHash('Private prompt'),inputTokens:51});expect(Object.isFrozen(result)).toBe(true);
 expect(result.inputHash).not.toBe(textInputHash('Other prompt'));expect(JSON.stringify(result)).not.toContain('Private prompt');
 expect(transport).toHaveBeenCalledTimes(1);
});
test('unapproved, invalid and already stopped requests cannot reach the network',async()=>{
 const transport=vi.fn<typeof fetch>();const counter=new ResponsesTokenCounter(transport);
 for(const patch of [{cloudApproved:false},{text:''},{text:'x'.repeat(8001)},{signal:AbortSignal.abort('private reason')}])
  await expect(counter.count({...request(),...patch},key)).rejects.toThrow();
 await expect(counter.count(request(),'bad')).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
test('malformed counts, HTTP failures, invalid encoding and oversized bodies fail closed',async()=>{
 const responses=[reply(null),reply([]),reply({object:'wrong',input_tokens:51}),
  ...[0,-1,1.5,1050001,'51',null].map(input_tokens=>reply({object:'response.input_tokens',input_tokens})),
  new Response('private provider error',{status:429}),new Response('{}'),
  new Response('x'.repeat(4097),{headers:{'content-type':'application/json'}}),
  new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}})];
 for(const response of responses){
  const transport=vi.fn<typeof fetch>(async()=>response);
  await expect(new ResponsesTokenCounter(transport).count(request(),key)).rejects.toThrow('Input token count unavailable');
  expect(transport).toHaveBeenCalledTimes(1);expect(response.body?.locked).toBe(false);
 }
});
test('STOP cancels a stalled body without disclosing abort details',async()=>{
 const controller=new AbortController();let cancelled=false;
 const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 const pending=new ResponsesTokenCounter(async()=>new Response(body,{headers:{'content-type':'application/json'}})).count({...request(),signal:controller.signal},key);
 await Promise.resolve();controller.abort('private stop reason');
 await expect(pending).rejects.toThrow('Token count cancelled');expect(cancelled).toBe(true);expect(body.locked).toBe(false);
});
test('the fixed deadline cancels a stalled body and never retries',async()=>{
 vi.useFakeTimers();const transport=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream<Uint8Array>(),{headers:{'content-type':'application/json'}}));
 // Node AbortSignal.timeout uses its own timer, so inject only that clock in this test.
 const timeout=new AbortController();const spy=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{expect(ms).toBe(15000);setTimeout(()=>timeout.abort(),ms);return timeout.signal;});
 try{
  const pending=new ResponsesTokenCounter(transport).count(request(),key);const checked=expect(pending).rejects.toThrow('Input token count unavailable');
  await vi.advanceTimersByTimeAsync(15000);await checked;expect(transport).toHaveBeenCalledTimes(1);
 }finally{spy.mockRestore();}
});
test('caller mutation while counting cannot rebind the result',async()=>{
 const input=request();let finish!:(value:Response)=>void;
 const pending=new ResponsesTokenCounter(()=>new Promise(resolve=>{finish=resolve;})).count(input,key);
 input.text='Replacement';finish(reply());
 expect((await pending).inputHash).toBe(textInputHash('Private prompt'));
});
