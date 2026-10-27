/** Streaming client for the HARMONY-supervised llama.cpp server.
 * Loopback only, per-launch random key, no tools, no history, no files or microphone context.
 * Raw server output never leaves this module except as bounded display text.
 */
export interface LocalEndpoint {readonly port:number;readonly key:string;readonly model:string;}
/** tool: a result HARMONY itself produced for a function the model asked for (never model or user text). */
export interface ChatTurn {role:'user'|'assistant'|'tool';content:string;}
/** A function the model may ask HARMONY to run. Asking grants nothing: HARMONY validates and decides. */
export interface ModelTool {name:string;description:string;parameters:{type:'object';properties:Record<string,{type:'string'|'number';description:string}>;required:readonly string[]};}
/** history: earlier turns of the current conversation only (bounded); nothing persists beyond it.
 * tools: functions offered to a Qwen model on the cache-exact completion route; other routes never offer tools. */
/** context: extra instructions HARMONY adds (e.g. what the person asked it to remember). Kept stable within a
 * conversation so the cached prompt prefix stays valid. */
/** finalRole 'tool': text is a function result HARMONY produced (e.g. web lookup data) and the model answers from it. */
export interface LocalChatRequest {text:string;maxOutputTokens:number;signal:AbortSignal;history?:readonly ChatTurn[];tools?:readonly ModelTool[];context?:string;finalRole?:'user'|'tool';}
export type LocalChatEvent=
 |{type:'text';text:string}
 |{type:'completed';inputTokens:number|null;outputTokens:number|null;finish:'stop'|'length'};

export const localInstructions='You are HARMONY, a warm, witty and capable personal assistant running privately on this computer. '
 +'Answer clearly and briefly, in a natural speaking style. You cannot run tools, open files, browse or inspect this computer, '
 +'and you must never claim that an action was performed. Your replies may be spoken aloud, so never use emoji, markdown or lists. '
 +'Each message starts with the current local time in parentheses: use it for anything about dates or times, but do not repeat it unless asked.';

/** Used instead of localInstructions when functions are offered. */
export const toolInstructions='You are HARMONY, a warm, witty and capable personal assistant running privately on this computer. '
 +'Answer clearly and briefly, in a natural speaking style. You can set reminders and timers, list them and cancel them with the functions provided; '
 +'when the person asks for one of those, call the function right away and say nothing before or after the call. '
 +'When the person explicitly asks you to remember or forget something about them, call remember or forget; never save things they did not ask you to. '
 +'For anything current or that you might not know (weather, news, scores, prices, recent events, facts you are unsure of), call get_weather, get_news or web_search instead of guessing. '
 +'If calendar_events or check_email are offered, use them for questions about the person\'s schedule or email. '
 +'If look_at_screen is offered, use it only when they ask you to look at, read or check their screen; if control_computer is offered, use it to open apps or websites, switch windows, or control music and volume. '
 +'Use research to start a background research mission when they ask you to research or dig into something, and to read it back later. '
 +'Use status_report when they say "status" or ask for a rundown; use workspace when they say "save my place" or "put me back". '
 +'If recall is offered, use it when they ask what they told you or what you talked about before. '
 +'For their projects: switch_project to change or start one, project_note to record a task, decision, blocker, note or finished task, and where_was_i when they ask where they left off. '
 +'You cannot do anything else on this computer or online, '
 +'and you must never claim that an action was performed unless a function result says so. Your replies may be spoken aloud, so never use emoji, markdown or lists. '
 +'Each message starts with the current local time in parentheses: use it for anything about dates or times, but do not repeat it unless asked.';

const failure=()=>new Error('Local response unavailable or incomplete');

/** Neutralise chat-format control markers in untrusted text so it can never open a new role or a hidden block. */
export function inertText(text:string):string{
 return text.replace(/<\|/g,'< |').replace(/\|>/g,'| >').replace(/<\s*\/?\s*think\s*>/gi,'(think)');
}
/** Person's words additionally cannot open function-call or function-result markup. */
export function inertUserText(text:string):string{
 return inertText(text).replace(/<(\s*\/?\s*)(tool_call|tool_response|tools|function|parameter)/gi,'‹$1$2');
}
/** Python json.dumps default spacing, as the model's chat template renders tools. */
function pyJson(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(pyJson).join(', ')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).map(([k,v])=>`${JSON.stringify(k)}: ${pyJson(v)}`).join(', ')}}`;
 return JSON.stringify(value);
}
/** The tool header exactly as the Qwen3.5 chat template writes it. */
export function qwenToolHeader(tools:readonly ModelTool[]):string{
 return '# Tools\n\nYou have access to the following functions:\n\n<tools>'+tools.map(t=>'\n'+pyJson({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}})).join('')+'\n</tools>'
  +'\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:\n\n<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>\n<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines\n</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:\n- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags\n- Required parameters MUST be specified\n- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after\n- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls\n</IMPORTANT>';
}
function validTools(tools:unknown):tools is readonly ModelTool[]{
 return Array.isArray(tools)&&tools.length<=24&&tools.every(t=>t&&typeof t.name==='string'&&/^[a-z_]{1,40}$/.test(t.name)&&typeof t.description==='string'&&t.description.length<=300
  &&t.parameters&&t.parameters.type==='object'&&Object.keys(t.parameters.properties??{}).length<=8);
}
/** Qwen3.x ChatML exactly as the model generates it. Earlier assistant turns keep the empty thinking block that the
 * generation prompt adds, so each new prompt extends the previous one token for token and llama.cpp reuses its cache
 * (the model's own chat template drops that block from history, which forced the last reply to be re-read every turn).
 * Format verified against the chat template embedded in Qwen3.5-4B-IQ4_XS.gguf on October 18, 2026.
 */
/** The system block every conversation prompt starts with (instructions, functions and remembered context). */
export function qwenSystemBlock(system:string,tools:readonly ModelTool[]=[]):string{
 return tools.length?`<|im_start|>system\n${qwenToolHeader(tools)}\n\n${inertText(system).trim()}<|im_end|>\n`:`<|im_start|>system\n${inertText(system).trim()}<|im_end|>\n`;
}
/** The system text for a request (the same composition as the completion route uses). */
export const systemText=(tools:readonly ModelTool[]|undefined,context:string|undefined)=>(tools?.length?toolInstructions:localInstructions)+(context?`\n\n${context}`:'');
export function qwenChatPrompt(system:string,history:readonly ChatTurn[],text:string,tools:readonly ModelTool[]=[],finalRole:'user'|'tool'='user'):string{
 const open='<|im_start|>assistant\n<think>\n\n</think>\n\n';
 let prompt=qwenSystemBlock(system,tools);
 for(const turn of history){
  if(turn.role==='user')prompt+=`<|im_start|>user\n${inertUserText(turn.content).trim()}<|im_end|>\n`;
  else if(turn.role==='tool')prompt+=`<|im_start|>user\n<tool_response>\n${inertUserText(turn.content).trim()}\n</tool_response><|im_end|>\n`;
  // The model's own earlier output, including any function call it made, is kept as generated.
  else prompt+=`${open}${inertText(turn.content)}<|im_end|>\n`;
 }
 const last=finalRole==='tool'?`<tool_response>\n${inertUserText(text).trim()}\n</tool_response>`:inertUserText(text).trim();
 return `${prompt}<|im_start|>user\n${last}<|im_end|>\n${open}`;
}

export function validateEndpoint(endpoint:LocalEndpoint):void{
 if(!endpoint||!Number.isSafeInteger(endpoint.port)||endpoint.port<1024||endpoint.port>65535
  ||typeof endpoint.key!=='string'||!/^[a-f0-9]{64}$/.test(endpoint.key)
  ||typeof endpoint.model!=='string'||!/^[a-zA-Z0-9_.-]{1,120}$/.test(endpoint.model))throw new Error('Invalid local endpoint');
}

/** Bounded SSE data reader: split UTF-8, CRLF, per-event and total limits. */
export async function* sseData(body:ReadableStream<Uint8Array>,signal:AbortSignal,limits={total:2*1024*1024,event:128*1024}):AsyncGenerator<string>{
 const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let buffer='',data:string[]=[],eventChars=0,total=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  while(true){
   signal.throwIfAborted();
   const chunk=await reader.read();
   signal.throwIfAborted();
   if(chunk.done){
    buffer+=decoder.decode();
    // A trailing event without its blank line is still a complete server-sent event at end of stream.
    if(buffer.trim().length)throw failure();
    if(data.length)yield data.join('\n');
    return;
   }
   total+=chunk.value.byteLength;if(total>limits.total)throw failure();
   buffer+=decoder.decode(chunk.value,{stream:true});
   let end:number;
   while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);
    eventChars+=line.length+1;if(eventChars>limits.event)throw failure();
    if(line===''){if(data.length){yield data.join('\n');data=[];}eventChars=0;}
    else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
   }
   if(buffer.length+eventChars>limits.event)throw failure();
  }
 }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw failure();return value as Record<string,unknown>;};
const count=(value:unknown):number|null=>value===undefined||value===null?null:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:(()=>{throw failure();})();

export class LocalChatClient {
 private transport:typeof fetch;private timeoutMs:number;#completionUnsupported=false;
 constructor(transport:typeof fetch=fetch,timeoutMs=120000){this.transport=transport;this.timeoutMs=timeoutMs;}
 /** Reads the shared start of every conversation prompt (instructions, functions, remembered context) into the
  * engine's cache ahead of time, without generating anything. Measured on Alec's PC (October 26): HARMONY's prompt
  * start is about 3,800 tokens and the GTX 1650 reads only about 100-150 a second with this model, so the first question
  * after the brain loads waited 30-40 s; and without a cache point at the end of that shared start, every new request
  * re-read its last ~500 tokens (3.5-5 s). Once warmed, each request reads only its own ~20 new tokens (0.35 s).
  * Qwen3 only (the exact prompt format); resolves false when it couldn't warm. */
 async warm(endpoint:LocalEndpoint,request:{tools?:readonly ModelTool[];context?:string;signal:AbortSignal}):Promise<boolean>{
  validateEndpoint(endpoint);
  if(!/^qwen3/i.test(endpoint.model)||this.#completionUnsupported)return false;
  if(request.tools!==undefined&&!validTools(request.tools))return false;
  if(request.context!==undefined&&(typeof request.context!=='string'||request.context.length>4000))return false;
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(Math.max(this.timeoutMs,180000))]);
  try{
   const response=await this.transport(`http://127.0.0.1:${endpoint.port}/completion`,{
    method:'POST',redirect:'error',signal,
    headers:{'Authorization':`Bearer ${endpoint.key}`,'Content-Type':'application/json'},
    body:JSON.stringify({prompt:qwenSystemBlock(systemText(request.tools,request.context),request.tools??[]),n_predict:0,cache_prompt:true})});
   await response.body?.cancel().catch(()=>{});
   return response.ok;
  }catch{return false;}
 }
 async *stream(endpoint:LocalEndpoint,request:LocalChatRequest):AsyncGenerator<LocalChatEvent>{
  validateEndpoint(endpoint);
  if(typeof request.text!=='string'||!request.text.trim()||request.text.length>8000
   ||!Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<16||request.maxOutputTokens>2048)throw new Error('Invalid local request');
  const history=request.history??[];
  if(request.tools!==undefined&&!validTools(request.tools))throw new Error('Invalid local request');
  if(request.context!==undefined&&(typeof request.context!=='string'||request.context.length>4000))throw new Error('Invalid local request');
  if(request.finalRole!==undefined&&request.finalRole!=='user'&&request.finalRole!=='tool')throw new Error('Invalid local request');
  if(!Array.isArray(history)||history.length>14||history.some(t=>!t||(t.role!=='user'&&t.role!=='assistant'&&t.role!=='tool')||typeof t.content!=='string'||!t.content.trim()||t.content.length>4000)
   ||history.reduce((n,t)=>n+t.content.length,0)>8000)throw new Error('Invalid local request');
  // Conversations (history supplied) with a Qwen3 model use exact, cache-friendly prompt formatting.
  if(request.history!==undefined&&/^qwen3/i.test(endpoint.model)&&!this.#completionUnsupported){
   let produced=false;
   try{for await(const event of this.#completion(endpoint,request,history)){produced=true;yield event;}return;}
   catch(error){
    // If the raw completion route fails before any words (e.g. a server format change), fall back to the standard
    // chat route for this and later requests rather than failing the conversation. Cancellation is never retried.
    if(produced||request.signal.aborted)throw error;
    this.#completionUnsupported=true;
   }
  }
  const controller=new AbortController();
  const signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(this.timeoutMs)]);
  let response:Response|undefined;
  try{
   signal.throwIfAborted();
   // Fixed loopback address; the port and key come only from the trusted supervisor.
   response=await this.transport(`http://127.0.0.1:${endpoint.port}/v1/chat/completions`,{
    method:'POST',redirect:'error',signal,
    headers:{'Authorization':`Bearer ${endpoint.key}`,'Content-Type':'application/json','Accept':'text/event-stream'},
    body:JSON.stringify({
     model:endpoint.model,stream:true,stream_options:{include_usage:true},max_tokens:request.maxOutputTokens,temperature:0.7,
     messages:[{role:'system',content:request.context?`${localInstructions}\n\n${request.context}`:localInstructions},...history.map(t=>t.role==='tool'?{role:'user',content:`Function result: ${t.content}`}:{role:t.role,content:t.content}),{role:'user',content:request.finalRole=='tool'?`Function result: ${request.text}`:request.text}],
     // Thinking mode adds seconds of hidden tokens before speech; conversational turns skip it.
     chat_template_kwargs:{enable_thinking:false}
    })
   });
   signal.throwIfAborted();
   if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0].trim()!=='text/event-stream')throw failure();
   let characters=0,finish:'stop'|'length'|null=null,inputTokens:number|null=null,outputTokens:number|null=null;
   for await(const data of sseData(response.body,signal)){
    signal.throwIfAborted();
    if(data==='[DONE]'){
     if(!finish)throw failure();
     yield {type:'completed',inputTokens,outputTokens,finish};return;
    }
    const event=record(JSON.parse(data));
    if(event.error!==undefined)throw failure();
    if(event.usage!==undefined&&event.usage!==null){const usage=record(event.usage);inputTokens=count(usage.prompt_tokens);outputTokens=count(usage.completion_tokens);}
    if(!Array.isArray(event.choices))throw failure();
    for(const raw of event.choices){
     const choice=record(raw);
     if(choice.index!==0)throw failure();
     if(choice.finish_reason!==undefined&&choice.finish_reason!==null){
      if(choice.finish_reason!=='stop'&&choice.finish_reason!=='length')throw failure();
      finish=choice.finish_reason;
     }
     if(choice.delta===undefined)continue;
     const delta=record(choice.delta);
     // Hidden reasoning and any tool-call fields are ignored: they are never display text or actions.
     if(delta.content===undefined||delta.content===null)continue;
     if(typeof delta.content!=='string')throw failure();
     characters+=delta.content.length;if(characters>32768)throw failure();
     if(delta.content)yield {type:'text',text:delta.content};
    }
   }
   throw failure();
  }catch{
   throw new Error(request.signal.aborted?'Local request cancelled':'Local response unavailable or incomplete');
  }finally{
   controller.abort();if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
  }
 }
 async *#completion(endpoint:LocalEndpoint,request:LocalChatRequest,history:readonly ChatTurn[]):AsyncGenerator<LocalChatEvent>{
  const controller=new AbortController();
  const signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(this.timeoutMs)]);
  let response:Response|undefined;
  try{
   signal.throwIfAborted();
   response=await this.transport(`http://127.0.0.1:${endpoint.port}/completion`,{
    method:'POST',redirect:'error',signal,
    headers:{'Authorization':`Bearer ${endpoint.key}`,'Content-Type':'application/json','Accept':'text/event-stream'},
    body:JSON.stringify({prompt:qwenChatPrompt(systemText(request.tools,request.context),history,request.text,request.tools??[],request.finalRole??'user'),n_predict:request.maxOutputTokens,temperature:0.7,
     stream:true,cache_prompt:true,stop:['<|im_end|>','<|im_start|>','<think>']})
   });
   signal.throwIfAborted();
   if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0].trim()!=='text/event-stream')throw failure();
   let characters=0;
   for await(const data of sseData(response.body,signal)){
    signal.throwIfAborted();
    if(data==='[DONE]')throw failure(); // Completion streams end with a stop event, never a bare [DONE] first.
    const event=record(JSON.parse(data));
    if(event.error!==undefined)throw failure();
    if(event.content!==undefined){
     if(typeof event.content!=='string')throw failure();
     characters+=event.content.length;if(characters>32768)throw failure();
     if(event.content)yield {type:'text',text:event.content};
    }
    if(event.stop===true){
     const stopType=event.stop_type;
     if(stopType!=='eos'&&stopType!=='word'&&stopType!=='limit')throw failure();
     yield {type:'completed',inputTokens:count(event.tokens_evaluated),outputTokens:count(event.tokens_predicted),finish:stopType==='limit'?'length':'stop'};
     return;
    }
   }
   throw failure();
  }catch{
   throw new Error(request.signal.aborted?'Local request cancelled':'Local response unavailable or incomplete');
  }finally{
   controller.abort();if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
  }
 }
}
