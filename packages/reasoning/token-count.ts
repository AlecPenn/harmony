import {textInput,textInputHash,type TextModel} from './text-contract.ts';
export interface CountedText {readonly inputHash:string;readonly inputTokens:number;}
const failure=()=>new Error('Input token count unavailable');
/** Private adapter: caller must obtain exact-text cloud permission before invoking.
 * Counting transmits the text; it is not a local estimate or generation permission.
 * No renderer endpoint, retry, arbitrary URL/model or prompt persistence.
 */
export class ResponsesTokenCounter {
 constructor(private transport:typeof fetch=fetch){}
 async count(request:{text:string;model?:TextModel;cloudApproved:boolean;signal:AbortSignal},key:string):Promise<CountedText>{
  if(request.cloudApproved!==true||typeof key!=='string'||key.length<16||key.length>512||!/^[A-Za-z0-9_-]+$/.test(key))throw new Error('Token count not authorized or invalid');
  // Snapshot input before any await; later caller mutation cannot change its binding.
  const input=textInput(request.text,request.model),inputHash=textInputHash(request.text,input.model),callerSignal=request.signal;
  const controller=new AbortController(),signal=AbortSignal.any([callerSignal,controller.signal,AbortSignal.timeout(15000)]);
  let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const cancel=()=>{void reader?.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
   signal.throwIfAborted();
   response=await this.transport('https://api.openai.com/v1/responses/input_tokens',{
    method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(input)});
   signal.throwIfAborted();
   if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw failure();
   reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
   while(true){
    signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();
    if(chunk.done){text+=decoder.decode();break;}
    size+=chunk.value.byteLength;if(size>4096)throw failure();text+=decoder.decode(chunk.value,{stream:true});
   }
   const value:unknown=JSON.parse(text);
   if(!value||typeof value!=='object'||Array.isArray(value))throw failure();
   const data=value as Record<string,unknown>,tokens=data.input_tokens;
   if(data.object!=='response.input_tokens'||typeof tokens!=='number'||!Number.isSafeInteger(tokens)||tokens<1||tokens>1050000)throw failure();
   return Object.freeze({inputHash,inputTokens:tokens});
  }catch{throw new Error(callerSignal.aborted?'Token count cancelled':'Input token count unavailable');}
  finally{
   controller.abort();signal.removeEventListener('abort',cancel);
   if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}
   else if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
  }
 }
}
