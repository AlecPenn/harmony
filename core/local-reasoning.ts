import {withTime} from '../packages/reasoning/time-context.ts';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {LocalChatClient,type LocalChatEvent,type LocalEndpoint,type LocalChatRequest} from '../packages/reasoning/local-chat.ts';
import {ApplicationEventBus} from './application-events.ts';
import type {TurnContext} from '../packages/contracts/events.ts';
import {emptyLocalReasoning,type LocalReasoningStatus} from '../packages/contracts/local-reasoning.ts';
import type {LocalModelServer} from './local-model.ts';
import {ToolCallFilter,type AssistantActions} from './assistant-actions.ts';

export interface LocalChat {stream(endpoint:LocalEndpoint,request:LocalChatRequest):AsyncGenerator<LocalChatEvent>;warm?(endpoint:LocalEndpoint,request:{tools?:readonly import('../packages/reasoning/local-chat.ts').ModelTool[];context?:string;signal:AbortSignal}):Promise<boolean>;}

/** Free, private typed requests to the locally supervised model.
 * Nothing leaves this computer, so no cost estimate or allowance applies. No files, microphone or history.
 * With actions supplied the model may ask for reminder functions, which HARMONY validates, runs and confirms.
 */
export class LocalReasoningController {
 #bus=new ApplicationEventBus();#status:LocalReasoningStatus={...emptyLocalReasoning};
 #task:Promise<void>|null=null;#abort:AbortController|null=null;#textTimer:ReturnType<typeof setTimeout>|null=null;
 constructor(private server:LocalModelServer,private changed:()=>void=()=>{},private client:LocalChat=new LocalChatClient(),readonly maxOutputTokens=512,private actions?:Pick<AssistantActions,'run'|'tools'>&{shortcut?(text:string):string|null;context?():string;related?(text:string,signal?:AbortSignal):Promise<string>;logTurn?(heard:string,reply:string):void}){
  if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<16||maxOutputTokens>2048)throw new Error('Invalid output limit');
 }
 get active(){return this.#task!==null||this.server.active;}
 get busy(){return this.#task!==null;}
 snapshot():LocalReasoningStatus{return structuredClone({...this.#status,model:this.server.snapshot()});}
 #notify(){if(this.#textTimer)clearTimeout(this.#textTimer);this.#textTimer=null;try{this.changed();}catch{}}
 #queueText(){if(!this.#textTimer)this.#textTimer=setTimeout(()=>this.#notify(),50);}
 ask(text:unknown):void{
  if(this.#task)throw new Error('Finish or cancel the current request first');
  if(typeof text!=='string'||!text.trim()||text.length>8000)throw new Error('Invalid request');
  const turn=this.#bus.beginTurn(),abort=new AbortController(),profiler=new LatencyProfiler();
  profiler.begin('reasoning');
  for(const field of ['wake_ms','speaker_id_ms','speech_end_ms','stt_ms','intent_ms','model_router_ms','tool_start_ms','tool_complete_ms','tts_first_audio_ms','ui_reaction_ms'] as const)profiler.notApplicable(field);
  this.#abort=abort;
  this.#status={...emptyLocalReasoning,state:'STARTING',prompt:text,trace:profiler.snapshot()};
  this.#task=this.#run(text,turn,abort,profiler).finally(()=>{this.#task=null;this.#abort=null;this.#bus.endTurn(turn);this.#notify();});
  this.#notify();
 }
 async #run(text:string,turn:TurnContext,abort:AbortController,profiler:LatencyProfiler){
  const current=()=>{abort.signal.throwIfAborted();if(!this.#bus.isCurrent(turn))throw new Error('Request expired');};
  let outcome:'completed'|'failed'|'cancelled'='failed';
  try{
   const warm=this.server.snapshot().state==='READY';
   const endpoint=await this.server.ensure(abort.signal);current();
   this.#status.state='STREAMING';this.#status.coldStartMs=warm?null:this.server.snapshot().loadMs;this.#notify();
   const first=profiler.start('llm_first_token_ms');let received=false;
   const filter=this.actions?new ToolCallFilter():null;
   // Functions are only offered on the cache-exact route, which an empty history selects.
   const context=this.actions?.context?.()??'';
   const related=this.actions?.related?await this.actions.related(text,abort.signal).catch(()=>''):'';current();
   const sent=withTime(text)+related;let raw='';
   const shortcut=filter?(()=>{try{return this.actions?.shortcut?.(text)??null;}catch{return null;}})():null;
   if(shortcut){raw=shortcut;filter!.push(shortcut);this.#status.state='FINISHED';outcome='completed';profiler.end(first);}
   else for await(const event of this.client.stream(endpoint,{text:sent,maxOutputTokens:this.maxOutputTokens,signal:abort.signal,...(this.actions?{history:[],tools:this.actions.tools,...(context?{context}:{})}:{})})){
    current();
    if(event.type==='completed'){
     this.#status.state='FINISHED';this.#status.truncated=event.finish==='length';
     this.#status.usage=event.inputTokens!==null&&event.outputTokens!==null?{inputTokens:event.inputTokens,outputTokens:event.outputTokens}:null;
     outcome='completed';break;
    }
    raw+=event.text;
    const visible=filter?filter.push(event.text):event.text;
    if(!received){received=true;profiler.end(first);this.#status.text+=visible;this.#status.trace=profiler.snapshot();this.#notify();}
    else if(visible){this.#status.text+=visible;this.#queueText();}
   }
   if(outcome!=='completed')throw new Error('Local response incomplete');
   const ending=filter?.finish();
   if(ending?.text)this.#status.text+=ending.text;
   if(ending?.calls.length&&this.actions){
    this.#status.state='STREAMING';
    const done=await this.actions.run(ending.calls,abort.signal,'typed');current();
    if(done.spoken)this.#status.text+=(this.#status.text.trim()&&!/\s$/.test(this.#status.text)?' ':'')+done.spoken;
    if(done.lookup){
     // Answer from the fetched data in a second pass; anything the model asks to run here is ignored.
     this.#status.sources=done.lookup.sources.map(({title,url,site})=>({title,url,site}));this.#notify();
     const answer=new ToolCallFilter();let answered=false;
     for await(const event of this.client.stream(endpoint,{text:done.lookup.report,finalRole:'tool',maxOutputTokens:this.maxOutputTokens,signal:abort.signal,
      history:[{role:'user',content:sent},{role:'assistant',content:raw}],tools:this.actions.tools,...(context?{context}:{})})){
      current();
      if(event.type==='completed'){answered=true;break;}
      const visible=answer.push(event.text);if(visible){this.#status.text+=visible;this.#queueText();}
     }
     if(!answered)throw new Error('Local response incomplete');
     this.#status.text+=answer.finish().text;
    }
    this.#status.state='FINISHED';
   }
   if(outcome==='completed')try{this.actions?.logTurn?.(text,this.#status.text);}catch{}
  }catch{
   outcome=abort.signal.aborted||!this.#bus.isCurrent(turn)?'cancelled':'failed';
   if(this.#bus.isCurrent(turn)||abort.signal.aborted){
    this.#status.state=outcome==='cancelled'?'CANCELLED':'ERROR';
    this.#status.error=outcome==='cancelled'?null:this.server.snapshot().state==='NOT_INSTALLED'
     ?'The local model is not installed yet. Run the local model setup first.'
     :'The local model did not finish. Any text shown is incomplete. Try again; if it keeps failing, run the local model check.';
   }
  }finally{
   profiler.finish(outcome);this.#status.trace=profiler.snapshot();
   if(outcome!=='cancelled')this.server.scheduleIdle();
  }
 }
 /** Cancel the current answer but keep the model loaded for the next request. */
 async cancel():Promise<void>{this.#abort?.abort();await this.#task;}
 /** STOP: revoke the turn, cancel generation and unload the model, waiting for actual exit. */
 async stop():Promise<void>{
  this.#bus.cancelAll();this.#abort?.abort();
  await this.#task;
  const error=await this.server.stop().then(()=>null,(e:unknown)=>e);
  if(this.#status.state!=='IDLE')this.#status={...this.#status,state:'CANCELLED',error:null};
  this.#notify();
  if(error)throw error;
 }
 clear(){if(this.#task)throw new Error('Request in progress');this.#status={...emptyLocalReasoning};this.#notify();}
}
