import {textInput,type TextModel} from './text-contract.ts';
/** Core-only text adapter. No renderer endpoint, credentials store or tool authority. */
export interface ReasoningRequest {
  text:string;
  model?:TextModel;
  cloudApproved:boolean;
  maxOutputTokens:number;
  signal:AbortSignal;
}
export type ReasoningEvent =
  | {type:'text';text:string}
  | {type:'refusal';text:string}
  | {type:'completed';inputTokens:number;outputTokens:number};
const endpoint='https://api.openai.com/v1/responses';
const failure=()=>new Error('Reasoning response unavailable or incomplete');

/** Bounded SSE decoding, including split UTF-8 and CRLF. Raw data never leaves this module. */
async function* events(body:ReadableStream<Uint8Array>,signal:AbortSignal):AsyncGenerator<unknown>{
  const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',data:string[]=[],eventChars=0,total=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();
      if(chunk.done){buffer+=decoder.decode();if(buffer.length||data.length)throw failure();return;}
      total+=chunk.value.byteLength;if(total>2*1024*1024)throw failure();
      buffer+=decoder.decode(chunk.value,{stream:true});
      let end:number;
      while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);
        eventChars+=line.length+1;if(eventChars>128*1024)throw failure();
        if(line===''){
          if(data.length){yield JSON.parse(data.join('\n'));data=[];}
          eventChars=0;
        }else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
      }
      if(buffer.length+eventChars>128*1024)throw failure();
    }
  }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw failure();return value as Record<string,unknown>;}
function count(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw failure();return value;}

export class ResponsesReasoner {
  constructor(private transport:typeof fetch=fetch){}
  async *stream(request:ReasoningRequest,key:string):AsyncGenerator<ReasoningEvent>{
    // Only an allowlisted model from the trusted approval boundary; no arbitrary URL or tools.
    if(request.cloudApproved!==true||typeof request.text!=='string'||!request.text.trim()||request.text.length>8000||
       !Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<16||request.maxOutputTokens>4096||
       typeof key!=='string'||key.length<16||key.length>512||!/^[A-Za-z0-9_-]+$/.test(key))throw new Error('Reasoning request not authorized or invalid');
    const input=textInput(request.text,request.model);
    const controller=new AbortController();
    const signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(120000)]);
    let response:Response|undefined;
    try{
      signal.throwIfAborted();
      response=await this.transport(endpoint,{
        method:'POST',redirect:'error',signal,
        headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json','Accept':'text/event-stream'},
        body:JSON.stringify({...input,stream:true,store:false,max_output_tokens:request.maxOutputTokens})
      });
      signal.throwIfAborted();
      if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0].trim()!=='text/event-stream')throw failure();
      let sequence=-1,characters=0;
      for await(const raw of events(response.body,signal)){
        signal.throwIfAborted();const event=record(raw);
        const next=count(event.sequence_number);if(next<=sequence)throw failure();sequence=next;
        if(typeof event.type!=='string')throw failure();
        if(['error','response.failed','response.incomplete'].includes(event.type))throw failure();
        if(event.type==='response.output_text.delta'||event.type==='response.refusal.delta'){
          if(typeof event.delta!=='string')throw failure();characters+=event.delta.length;
          if(characters>32768)throw failure();
          if(event.delta)yield {type:event.type==='response.refusal.delta'?'refusal':'text',text:event.delta};
        }else if(event.type==='response.completed'){
          const completed=record(event.response);if(completed.status!=='completed'||completed.model!==input.model)throw failure();
          const usage=record(completed.usage);
          yield {type:'completed',inputTokens:count(usage.input_tokens),outputTokens:count(usage.output_tokens)};
          return;
        }
        // Reasoning, tool arguments and metadata never become display text or actions.
      }
      throw failure();
    }catch{
      // Never forward provider errors, prompts, keys or arbitrary abort reasons.
      throw new Error(request.signal.aborted?'Reasoning cancelled':'Reasoning response unavailable or incomplete');
    }finally{
      controller.abort();if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
    }
  }
}
