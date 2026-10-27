import {performance} from 'node:perf_hooks';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {VoicePhrases} from '../packages/voice/phrases.ts';
import {withTime} from '../packages/reasoning/time-context.ts';
import {emptyConversation,type ConversationStatus} from '../packages/contracts/conversation.ts';
import type {LocalModelServer} from './local-model.ts';
import type {LocalChat} from './local-reasoning.ts';
import type {ConversationSpeech} from './conversation-speech.ts';
import {ToolCallFilter,LOOKUP_FUNCTIONS,type AssistantActions} from './assistant-actions.ts';
import type {ChatTurn} from '../packages/reasoning/local-chat.ts';
import type {Verdict} from './guardian.ts';
import {DENY} from './wake-learner.ts';
import {classify} from './speed-scoreboard.ts';
/** The guardian, as the conversation sees it: who said this, words it handles itself, and guest mode. */
export interface ConversationGuard {verdict(segment:number|null):Promise<Verdict>;intercept(text:string,verdict:Verdict):string|null;guest(verdict:Verdict):boolean;ignoreStrangers():boolean;begin(channel:'voice',verdict:Verdict):void;wake?():void;spoken?(text:string,segment:number):void;}
/** Guest mode: someone whose voice isn't the owner's (or HARMONY is locked). No memory, history or functions. */
export const GUEST_CONTEXT='You are talking with a guest, not the person you belong to. Be friendly and help with general questions only. You have no access to their memory, messages, calendar, files, screen or computer right now; never guess at personal details about them.';

type Actions=Pick<AssistantActions,'tools'>&{run(calls:Parameters<AssistantActions['run']>[0],signal:AbortSignal,source?:'voice',say?:(text:string)=>void):ReturnType<AssistantActions['run']>}&{shortcut?(text:string):string|null;egg?(text:string):{say:string;flourish:string|null}|null;context?():string;touchProject?():void;related?(text:string,signal?:AbortSignal):Promise<string>;logTurn?(heard:string,reply:string):void;warm?():void};
class GuardIgnored extends Error {}
/** Keeps history cache-friendly (it only grows, then drops a block at once) and always starting at a person's turn. */
export function trimHistory(history:readonly ChatTurn[]):ChatTurn[]{
 let next=[...history];
 const fix=()=>{while(next.length&&next[0].role!=='user')next.shift();};
 if(next.length>12){next=next.slice(6);fix();}
 while(next.length>2&&next.reduce((n,t)=>n+t.content.length,0)>7000){next.shift();fix();}
 return next;
}

export type TranscriptEvent={kind:'speech_start'|'endpoint';segment:number}|{kind:'wake';confidence:number}|{kind:'wake_candidate'}|{kind:'interrupt';word:string;confidence?:number}|{kind?:'transcript';text:string;final:boolean;sttMs:number;segment?:number|null};
export interface ConversationListener {start(mode:'conversation'|'hands-free'):Promise<{sessionId:string}>;stop():Promise<void>;setTranscriptListener(listener:((event:TranscriptEvent)=>void)|null):void;setListening?(enabled:boolean):void;setWakeWait?(enabled:boolean):void;setInterruptWatch?(enabled:boolean,ignore:readonly string[]):void;standby?(mode:'conversation'|'hands-free'):Promise<void>|void;upgrade?():void;wakeOutcome?(what:'used'|'unused'|'denied'):void;}
/** Words that cut HARMONY off while it is talking (spotted offline). */
export const interruptWords=['harmony','stop'] as const;
/** "Harmony, what time is it?" → "what time is it?" (the wake word is not part of the request). */
export function stripWakeWord(text:string):string{return text.replace(/^\s*(?:(?:hey|hi|okay|ok)[\s,]+)?harmony\b[\s,.!?:;-]*/i,'').trim();}

// Whisper commonly invents these on silence or breath noise; they are never treated as a request.
const noise=new Set(['','you','thank you','thanks','thanks for watching','thank you for watching','bye','okay','ok','uh','um','hmm','mm']);
export function meaningful(text:string):boolean{
 const plain=text.toLowerCase().replace(/[^a-z0-9' ]+/g,' ').replace(/\s+/g,' ').trim();
 return plain.length>=2&&!noise.has(plain);
}

/** Local desktop voice loop: microphone → local transcription → local model → phrase-streamed Piper speech.
 * Started only by an explicit click at this computer. Half-duplex: while HARMONY thinks or speaks, new
 * transcripts are ignored so it never answers its own voice. With actions supplied, the model may ask for reminder
 * and timer functions; HARMONY validates and runs them and speaks fixed confirmations. Nothing leaves the PC.
 */
/** Experiment switch: load the voice alongside hearing and the brain instead of after hearing. */
const PARALLEL_VOICE=process.env.HARMONY_PARALLEL_VOICE!=='0';
export class ConversationController {
 #status:ConversationStatus={...emptyConversation};#generation=0;#turnAbort:AbortController|null=null;
 #lastTurn:import('./diagnostics.ts').TurnTimings|null=null;
 /** The last completed spoken reply's measured timings, for "why are you slow?". */
 get lastTurn(){return this.#lastTurn;}
 /** Step 23: every completed spoken reply's timings, for the speed scoreboard. */
 onTimed:((t:import('./diagnostics.ts').TurnTimings,kind:import('./speed-scoreboard.ts').TurnKind)=>void)|null=null;
 onStartup:((totalMs:number)=>void)|null=null;
 #turnTask:Promise<void>|null=null;#busySegments=new Set<number>();#endpoints=new Map<number,number>();#history:ChatTurn[]=[];#announcing=0;#handsFree=false;#interruptIgnore=new Set<string>();#interruptedAnnouncement=false;#announcementAbort:AbortController|null=null;#context='';#followup:ReturnType<typeof setTimeout>|null=null;#announceQueue:Promise<void>=Promise.resolve();#announceAbort=new AbortController();#listeningSince=0;#warm:Promise<void>|null=null;#stopping:Promise<void>|null=null;#active=false;#challenge=false;#wakePending=false;#lastHandsFree=false;
 constructor(private listener:ConversationListener,private server:Pick<LocalModelServer,'ensure'|'scheduleIdle'>,private chat:LocalChat,
  private speech:Pick<ConversationSpeech,'prepare'|'begin'|'cancelTurn'|'stop'|'active'>,private changed:()=>void=()=>{},readonly maxOutputTokens=320,readonly echoGraceMs=700,private now:()=>Date=()=>new Date(),private actions?:Actions,readonly followupMs=8000){}
 /** Set by the desktop app: voice checks, lock words and guest mode. Absent means everyone is treated as the owner. */
 guard:ConversationGuard|null=null;
 get active(){return this.#active||this.#stopping!==null||this.speech.active;}
 /** Doing something the person would notice (talking, listening or announcing), as opposed to a warm idle voice. */
 get busy(){return this.#active||this.#stopping!==null||this.#announcing>0;}
 snapshot():ConversationStatus{return structuredClone(this.#status);}
 #notify(){try{this.changed();}catch{}}
 #set(patch:Partial<ConversationStatus>){Object.assign(this.#status,patch);this.#notify();}
 #clearFollowup(){if(this.#followup)clearTimeout(this.#followup);this.#followup=null;}
 /** Hands-free: after a reply, keep listening for follow-ups for a few seconds, then go back to waiting for "Harmony". */
 #startFollowup(generation:number){
  this.#clearFollowup();if(!this.#handsFree)return;
  this.#followup=setTimeout(()=>{
   this.#followup=null;
   if(generation===this.#generation&&this.#active&&this.#status.state==='LISTENING'&&!this.#status.transcribing&&!this.#turnTask&&this.#announcing===0)this.#enterWaiting();
  },this.followupMs);this.#followup.unref?.();
 }
 /** Starts or updates interrupt watching; words HARMONY itself is about to say are ignored so it never cuts itself off. */
 #watchInterrupts(spoken=''){
  if(this.#challenge)return; // listening for approval words; the interrupt watch would take the audio
  const before=this.#interruptIgnore.size,said=spoken.toLowerCase();
  for(const word of interruptWords)if(new RegExp(`\\b${word}\\b`).test(said))this.#interruptIgnore.add(word);
  if(spoken&&this.#interruptIgnore.size===before)return;
  try{this.listener.setInterruptWatch?.(true,[...this.#interruptIgnore]);}catch{}
 }
 /** The guardian is waiting for spoken approval words: listen in the middle of a turn (the interrupt watch is paused,
  * since it would take the audio) and send what's heard to the guardian, not the brain. Returns whether the mic is live. */
 challenge(on:boolean):boolean{
  if(!on){
   if(!this.#challenge)return false;this.#challenge=false;
   if(this.#status.state!=='LISTENING'){try{this.listener.setListening?.(false);}catch{}if(this.#active)this.#watchInterrupts();}
   return true;
  }
  if(!this.#active||!this.guard?.spoken||!['THINKING','SPEAKING'].includes(this.#status.state))return false;
  this.#challenge=true;this.#stopWatching();try{this.listener.setListening?.(true);}catch{}return true;
 }
 #stopWatching(){this.#interruptIgnore.clear();try{this.listener.setInterruptWatch?.(false,[]);}catch{}}
 #wakeResult(what:'used'|'unused'|'denied'){if(!this.#wakePending)return;this.#wakePending=false;try{this.listener.wakeOutcome?.(what);}catch{}}
 #enterWaiting(){
  this.#wakeResult('unused'); // woke, but nothing was asked
  this.#clearFollowup();this.#endpoints.clear();
  try{this.listener.setWakeWait?.(true);}catch{}
  this.#set({state:'WAITING',heard:'',transcribing:false});
 }
 /** Step 25: a hand sign seen by the camera. "stop" (a held-up palm) cuts in like saying "stop" while she's talking;
  * "wave" wakes her while she's waiting for "Harmony" (without teaching the wake-word learner anything). */
 gesture(sign:'stop'|'wave'):boolean{
  if(!this.#active)return false;
  const g=this.#generation;
  if(sign==='stop'){
   if(!['THINKING','SPEAKING'].includes(this.#status.state))return false;
   this.#heard({kind:'interrupt',word:'gesture'},g);return true;
  }
  if(this.#status.state!=='WAITING')return false;
  try{this.listener.setWakeWait?.(false);}catch{} // the speech worker didn't hear a wake word, so tell it to listen
  this.#heard({kind:'wake',confidence:1},g);this.#wakePending=false;return true;
 }
 /** Talk-start speed: loads the brain and the voice ahead of time, while nothing else is going on, so pressing "Talk to
  * HARMONY" only has to open the microphone. Safe to call repeatedly; does nothing during a conversation. */
 prewarm():void{
  if(this.#active||this.#stopping)return;
  // Launch speed (October 26), measured on Alec's PC. Hearing (Whisper), the brain (llama.cpp: mostly a 2.4 GB
  // disk-to-GPU read) and the voice (Piper, ~4 s since ONNX Runtime 1.22) load side by side: about 21 s to all ready,
  // the same as voice-after-hearing and far better than one after another (~30 s). (Before the ONNX Runtime fix the
  // voice took 15 s and loading everything at once slowed everything.) HARMONY_PARALLEL_VOICE=0 loads the voice after
  // hearing. The heavy Parakeet upgrade waits until hearing, brain and voice are loaded, then runs in background mode.
  if(this.#warming)return;
  const go=()=>!this.#active&&!this.#stopping;
  let hearing:Promise<void>|void=undefined;
  try{hearing=this.listener.standby?.(this.#lastHandsFree?'hands-free':'conversation');}catch{}
  const brain=this.server.ensure(this.#announceAbort.signal).then(endpoint=>{void this.#warmPrompt(endpoint,this.actions?.context?.()??'');},()=>{});
  const voice=(PARALLEL_VOICE?Promise.resolve():Promise.resolve(hearing).catch(()=>{})).then(()=>go()?this.speech.prepare():undefined).catch(()=>{});
  this.#warming=Promise.all([brain,voice,Promise.resolve(hearing).catch(()=>{})]).then(()=>{try{this.listener.upgrade?.();}catch{}}).finally(()=>{this.#warming=null;});
 }
 #warming:Promise<void>|null=null;
 #warmedFor='';
 /** Step 40: reads the shared start of the prompt (instructions, functions, this conversation's remembered context)
  * into the brain's cache in the background, once per brain start and context, so the first question doesn't wait
  * 30-40 s and later ones read only their own words. A question asked meanwhile simply queues behind it and reuses it. */
 async #warmPrompt(endpoint:import('../packages/reasoning/local-chat.ts').LocalEndpoint,context:string):Promise<void>{
  if(!this.chat.warm||!this.actions)return;
  const key=`${endpoint.port}|${endpoint.key.slice(0,8)}|${context}`;if(this.#warmedFor===key)return;
  this.#warmedFor=key;
  try{if(!await this.chat.warm(endpoint,{tools:this.actions.tools,...(context?{context}:{}),signal:this.#announceAbort.signal}))this.#warmedFor='';}catch{this.#warmedFor='';}
 }
 /** Starts listening (or, hands-free, waiting for "Harmony"). Returns the capture session for the chamber;
  * model and voice warm up in the background. */
 async start(options:{handsFree?:boolean}={}):Promise<{sessionId:string}>{
  if(this.#active||this.#stopping)throw new Error('Conversation already active');
  this.#handsFree=options.handsFree===true;
  this.#lastHandsFree=this.#handsFree;
  const generation=++this.#generation;this.#active=true;
  // Memory is read once per conversation so every turn shares the same cached prompt prefix.
  this.#context=this.actions?.context?.()??'';try{this.actions?.warm?.();}catch{}this.#busySegments.clear();this.#endpoints.clear();this.#history=[];this.#challenge=false;this.#listeningSince=0;
  this.#status={...emptyConversation,state:'STARTING',handsFree:this.#handsFree};this.#notify();
  this.listener.setTranscriptListener(event=>{if(generation===this.#generation)this.#heard(event,generation);});
  // Load the speech model, the brain and the voice at the same time, and only hand the microphone over once all three
  // are ready: loading the brain and voice used to happen while audio was already streaming, which overloaded a
  // 4-thread CPU ("Audio could not keep up") and made the waits add up instead of overlapping.
  const abort=new AbortController();this.#turnAbort=abort;const began=performance.now();
  const startup={speechMs:null as number|null,brainMs:null as number|null,voiceMs:null as number|null,totalMs:null as number|null};
  const timed=<T,>(p:Promise<T>,key:'speechMs'|'brainMs'|'voiceMs')=>p.then(v=>{startup[key]=Math.round(performance.now()-began);return v;});
  const listening=timed(this.listener.start(this.#handsFree?'hands-free':'conversation'),'speechMs');
  const warm=Promise.all([timed(this.server.ensure(abort.signal),'brainMs'),timed(this.speech.prepare(),'voiceMs')]);
  listening.catch(()=>{});warm.catch(()=>{});
  let session:{sessionId:string};
  try{session=await listening;}
  catch{if(this.#turnAbort===abort)this.#turnAbort=null;if(generation===this.#generation){await this.stop();this.#set({state:'ERROR',error:'The microphone pipeline could not start. Check the local speech setup.'});}throw new Error('Conversation unavailable');}
  if(generation!==this.#generation){throw new Error('Conversation cancelled');}
  try{await warm;}
  catch{
   if(this.#turnAbort===abort)this.#turnAbort=null;
   if(generation===this.#generation){await this.stop();this.#set({state:'ERROR',error:'The local brain or voice could not start. Check that the local brain and Piper voice are set up.'});}
   throw new Error('Conversation unavailable');
  }
  if(this.#turnAbort===abort)this.#turnAbort=null;
  if(generation!==this.#generation){throw new Error('Conversation cancelled');}
  warm.then(([endpoint])=>{void this.#warmPrompt(endpoint,this.#context);},()=>{});
  startup.totalMs=Math.round(performance.now()-began);
  try{this.listener.upgrade?.();}catch{} // voice and brain are loaded: hearing may load its Parakeet upgrade now
  try{this.onStartup?.(startup.totalMs);}catch{}
  this.#set({startup});
  if(this.#status.state==='STARTING'){if(this.#handsFree)this.#enterWaiting();else this.#set({state:'LISTENING'});}
  return session;
 }
 #heard(event:TranscriptEvent,generation:number){
  if(event.kind==='wake_candidate')return;
  if(event.kind==='interrupt'){
   const speaking=['THINKING','SPEAKING'].includes(this.#status.state);
   if(!speaking)return;
   // Cut in: drop the reply (or announcement) and listen right away. The worker is already listening and has kept
   // what was said after the word, so "Stop, what's the weather instead?" arrives as the next request.
   this.#interruptIgnore.clear();
   if(this.#announcing>0){this.#interruptedAnnouncement=true;this.#announcementAbort?.abort();}
   this.#turnAbort?.abort();void this.speech.cancelTurn().catch(()=>{});
   this.#listeningSince=0;
   this.#set({state:'LISTENING',speechSession:null,announcement:null,heard:'',transcribing:false,interruptions:this.#status.interruptions+1});
   this.#startFollowup(generation);
   return;
  }
  if(event.kind==='wake'){
   if(this.#status.state!=='WAITING')return;
   // Heard "Harmony": listen now (no echo grace: HARMONY was silent) and load the brain while the request is spoken.
   this.#listeningSince=0;this.#wakePending=true;this.#set({state:'LISTENING',heard:'',error:null});this.#startFollowup(generation);
   void this.server.ensure(this.#announceAbort.signal).catch(()=>{});
   try{this.guard?.wake?.();}catch{} // a quick camera look, if face checks are on
   return;
  }
  if(this.#challenge){
   if('text' in event&&event.final&&typeof event.text==='string'&&Number.isSafeInteger(event.segment)){try{this.guard?.spoken?.(event.text.slice(0,200),event.segment as number);}catch{}}
   return;
  }
  if(event.kind==='speech_start'||event.kind==='endpoint'){
   if(!Number.isSafeInteger(event.segment))return;
   if(this.#status.state!=='LISTENING'){if(this.#busySegments.size<256)this.#busySegments.add(event.segment);return;}
   if(this.#busySegments.has(event.segment))return;
   if(event.kind==='speech_start'){
    // Speech that starts in the grace window right after a reply is treated as HARMONY's own tail.
    if(performance.now()-this.#listeningSince<this.echoGraceMs){if(this.#busySegments.size<256)this.#busySegments.add(event.segment);}
    else this.#clearFollowup(); // The person is talking: don't go back to waiting mid-sentence.
    return;
   }
   this.#clearFollowup();
   // The voice detector says you stopped talking: show it immediately and time the turn from here.
   if(this.#endpoints.size>32)this.#endpoints.clear();
   this.#endpoints.set(event.segment,performance.now());this.#set({transcribing:true,heard:''});
   return;
  }
  if(!('text' in event)||typeof event.text!=='string')return;
  const text=(this.#handsFree?stripWakeWord(event.text):event.text.trim()).slice(0,2000);
  const segment=Number.isSafeInteger(event.segment)?event.segment as number:null;
  // Speech that began while HARMONY was thinking or talking is most likely its own voice; never answer it.
  if(this.#status.state!=='LISTENING'){
   if(segment!==null&&this.#busySegments.size<256)this.#busySegments.add(segment);
   if(event.final&&['THINKING','SPEAKING'].includes(this.#status.state))this.#set({ignoredWhileBusy:this.#status.ignoredWhileBusy+1});
   return;
  }
  if(segment!==null&&this.#busySegments.has(segment)){if(event.final){this.#busySegments.delete(segment);this.#set({ignoredWhileBusy:this.#status.ignoredWhileBusy+1});}return;}
  if(!event.final){if(text)this.#set({heard:text});return;}
  if(performance.now()-this.#listeningSince<this.echoGraceMs){this.#set({ignoredWhileBusy:this.#status.ignoredWhileBusy+1});return;}
  const endpointAt=segment!==null?this.#endpoints.get(segment)??null:null;if(segment!==null)this.#endpoints.delete(segment);
  if(!meaningful(text)){this.#set({heard:'',transcribing:false});this.#startFollowup(generation);return;}
  // "Never mind" / "that wasn't me" right after a wake: a false wake, which the wake word learns from. Back to waiting.
  if(this.#wakePending&&DENY.test(text.toLowerCase().replace(/^\s*(hey\s+)?harmony[,.!]?\s*/,'').replace(/[.!?,]+$/,'').trim())){this.#wakeResult('denied');if(this.#handsFree)this.#enterWaiting();else this.#set({heard:'',transcribing:false});return;}
  // With an endpoint, transcription time is the real wait you experienced (including any queueing).
  const sttMs=endpointAt!==null?Math.round(performance.now()-endpointAt):Number.isFinite(event.sttMs)?Math.round(event.sttMs):null;
  this.#turnTask=this.#turn(text,sttMs,generation,endpointAt,segment).finally(()=>{this.#turnTask=null;});
 }
 async #turn(text:string,sttMs:number|null,generation:number,endpointAt:number|null=null,segment:number|null=null){
  const abort=new AbortController();this.#turnAbort=abort;
  // Timings run from when you stopped talking when known, otherwise from when the transcript arrived.
  const started=endpointAt??performance.now(),since=()=>Math.round(performance.now()-started);
  const profiler=new LatencyProfiler();profiler.begin('conversation');
  for(const field of ['wake_ms','speaker_id_ms','speech_end_ms','stt_ms','intent_ms','model_router_ms','tool_start_ms','tool_complete_ms'] as const)profiler.notApplicable(field);
  const firstToken=profiler.start('llm_first_token_ms'),firstAudio=profiler.start('tts_first_audio_ms'),uiReaction=profiler.start('ui_reaction_ms');
  const timing={sttMs,firstWordsMs:null as number|null,firstAudioMs:null as number|null,playbackStartMs:null as number|null};
  try{this.listener.setListening?.(false);}catch{}
  this.#interruptIgnore.clear();this.#watchInterrupts();
  this.#set({state:'THINKING',transcribing:false,heard:text,reply:'',sources:[],speechSession:null,error:null,timing:{...timing},trace:profiler.snapshot()});
  const current=()=>{abort.signal.throwIfAborted();if(generation!==this.#generation)throw new Error('Conversation ended');};
  let turn:ReturnType<ConversationController['speech']['begin']>|null=null,outcome:'completed'|'failed'|'cancelled'='failed';
  const speak=(phrase:string)=>{
   if(!turn){
    turn=this.speech.begin({
     firstAudio:()=>{if(generation!==this.#generation||abort.signal.aborted)return;timing.firstAudioMs=since();profiler.end(firstAudio);this.#set({timing:{...timing},trace:profiler.snapshot()});},
     playbackStarted:()=>{if(generation!==this.#generation||abort.signal.aborted)return;timing.playbackStartMs=since();profiler.end(uiReaction);this.#set({state:'SPEAKING',timing:{...timing},trace:profiler.snapshot()});}
    });
    this.#set({speechSession:turn.id});
   }
   this.#watchInterrupts(phrase);turn.push(phrase);
  };
  try{
   const phrases=new VoicePhrases(240,4000,true);let completed=false,raw='',sent='';let toolTurns:ChatTurn[]=[];let toolMs:number|null=null;
   // Who said it (voice print, computed alongside transcription), and words the guardian handles itself.
   let verdict:Verdict={who:'unchecked',score:null},guest=false,fixed:string|null=null,viaShortcut=false,instant=false;
   if(this.guard){
    verdict=await this.guard.verdict(segment).catch(()=>verdict);current();
    if(verdict.who!=='stranger')this.#wakeResult('used');else this.#wakePending=false; // someone else saying it isn't a lesson either way
    fixed=(()=>{try{return this.guard!.intercept(text,verdict);}catch{return null;}})();
    if(fixed===null&&this.guard.guest(verdict)){
     // A stranger, with "ignore strangers" on: no reply at all.
     if(verdict.who==='stranger'&&this.guard.ignoreStrangers())throw new GuardIgnored();
     guest=true;
    }
    this.guard.begin('voice',verdict);
   }
   else this.#wakeResult('used');
   // Easter eggs ("Harmony, flex"): a fixed line and a visual flourish, no brain needed.
   const egg=fixed!==null?{say:fixed,flourish:null}:guest?null:(()=>{try{return this.actions?.egg?.(text)??null;}catch{return null;}})();
   if(egg){instant=true;raw=egg.say;this.#status.reply=egg.say;this.#notify();for(const phrase of phrases.push(egg.say))speak(phrase);}
   else if(guest){
    const endpoint=await this.server.ensure(abort.signal);current();
    // Guest mode: no memory, no history, no functions; nothing is kept afterwards.
    for await(const event of this.chat.stream(endpoint,{text:withTime(text,this.now()),maxOutputTokens:this.maxOutputTokens,signal:abort.signal,history:[],context:GUEST_CONTEXT})){
     current();if(event.type==='completed'){completed=true;break;}
     if(timing.firstWordsMs===null){timing.firstWordsMs=since();profiler.end(firstToken);}
     this.#status.reply+=event.text;this.#notify();for(const phrase of phrases.push(event.text))speak(phrase);
    }
    if(!completed)throw new Error('Local reply incomplete');
   }
   else{
   const endpoint=await this.server.ensure(abort.signal);current();
   const filter=this.actions?new ToolCallFilter():null;
   // The exact user content sent (time line + words + any clearly related memory) is also what history keeps, so later
   // prompts match the cache. Related memory is usually empty; when present it's at most two short lines.
   const related=this.actions?.related?await this.actions.related(text,abort.signal).catch(()=>''):'';current();
   sent=withTime(text,this.now())+related;
   // Exact short commands skip the first brain pass: the same call markup is used, so everything after is unchanged.
   const shortcut=filter?(()=>{try{return this.actions?.shortcut?.(text)??null;}catch{return null;}})():null;
   if(shortcut){viaShortcut=true;raw=shortcut;filter!.push(shortcut);completed=true;timing.firstWordsMs=since();profiler.end(firstToken);}
   else for await(const event of this.chat.stream(endpoint,{text:sent,maxOutputTokens:this.maxOutputTokens,signal:abort.signal,history:[...this.#history],...(this.actions?{tools:this.actions.tools}:{}),...(this.#context?{context:this.#context}:{})})){
    current();
    if(event.type==='completed'){completed=true;break;}
    if(timing.firstWordsMs===null){timing.firstWordsMs=since();profiler.end(firstToken);}
    raw+=event.text;
    // Function-call markup never reaches the screen or the voice.
    const visible=filter?filter.push(event.text):event.text;
    if(visible){this.#status.reply+=visible;this.#notify();for(const phrase of phrases.push(visible))speak(phrase);}
   }
   if(!completed)throw new Error('Local reply incomplete');
   const ending=filter?.finish();
   if(ending?.text){this.#status.reply+=ending.text;this.#notify();for(const phrase of phrases.push(ending.text))speak(phrase);}
   if(ending?.calls.length&&this.actions){
    // A lookup takes a moment (network, then reading the results): say so straight away.
    // Looking at the screen is always announced, so it's never silent.
    if(ending.calls.some(c=>LOOKUP_FUNCTIONS.has(c.name))&&!this.#status.reply.trim())speak(ending.calls.some(c=>c.name==='look_at_screen')?'Looking.':'One sec.');
    // HARMONY, not the model, decides and does; the spoken confirmation is fixed text describing what actually happened.
    const toolStarted=performance.now();const done=await this.actions.run(ending.calls,abort.signal,'voice',speak);toolMs=Math.round(performance.now()-toolStarted);current();
    if(done.spoken){
     const said=(this.#status.reply.trim()&&!/\s$/.test(this.#status.reply)?' ':'')+done.spoken;
     this.#status.reply+=said;this.#notify();for(const phrase of phrases.push(said))speak(phrase);
    }
    toolTurns=[{role:'tool',content:done.report.slice(0,3000)},{role:'assistant',content:done.spoken||'Okay.'}];
    if(done.lookup){
     // Second pass: the model answers from the fetched data. Same prompt prefix (tools still listed) so the engine reuses
     // its cache, but nothing it asks for in this pass is ever run: web text can never trigger an action.
     const answer=new ToolCallFilter();let answerRaw='',answered=false;
     this.#set({sources:done.lookup.sources.map(({title,url,site})=>({title,url,site}))});
     for await(const event of this.chat.stream(endpoint,{text:done.lookup.report,finalRole:'tool',maxOutputTokens:this.maxOutputTokens,signal:abort.signal,
      history:[...this.#history,{role:'user',content:sent},{role:'assistant',content:raw}],...(this.actions?{tools:this.actions.tools}:{}),...(this.#context?{context:this.#context}:{})})){
      current();
      if(event.type==='completed'){answered=true;break;}
      answerRaw+=event.text;
      const visible=answer.push(event.text);
      if(visible){this.#status.reply+=visible;this.#notify();for(const phrase of phrases.push(visible))speak(phrase);}
     }
     if(!answered)throw new Error('Local reply incomplete');
     const tail=answer.finish().text;if(tail){this.#status.reply+=tail;this.#notify();for(const phrase of phrases.push(tail))speak(phrase);}
     toolTurns=[{role:'tool',content:done.lookup.report.slice(0,3000)},{role:'assistant',content:answerRaw.trim()?answerRaw:'Okay.'}];
    }
   }
   }
   for(const phrase of phrases.finish())speak(phrase);
   current();
   if(turn){
    (turn as {finish():void}).finish();
    // Ending the conversation must never wait on audio that will not finish playing.
    await Promise.race([(turn as {done:Promise<void>}).done,new Promise<never>((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(new Error('Conversation ended')),{once:true});})]);
   }
   current();outcome='completed';if(!guest)try{this.actions?.touchProject?.();}catch{}
   this.#lastTurn={...timing,toolMs,at:new Date().toISOString()};
   try{this.onTimed?.(this.#lastTurn,classify({fixed:instant,shortcut:viaShortcut,guest,toolMs}));}catch{}if(!guest&&fixed===null)try{this.actions?.logTurn?.(text,this.#status.reply);}catch{}
   // Remember this exchange for follow-ups within the conversation. History only grows, so the engine can reuse its
   // cache of everything already read; when it reaches 6 exchanges the oldest 3 are dropped at once (a rare re-read)
   // instead of sliding every turn, which forced a full re-read each time.
   // Keep the reply exactly as generated (not trimmed) so the next prompt matches the engine's cache token for token.
   // The model's raw output (including any function call) is kept, followed by the function result and confirmation.
   if(!egg&&!guest&&raw.trim()&&raw.length<=3500)this.#history=trimHistory([...this.#history,{role:'user',content:sent},{role:'assistant',content:raw},...toolTurns]);
   this.#stopWatching();this.#listeningSince=performance.now();try{this.listener.setListening?.(true);}catch{}this.#set({state:'LISTENING',speechSession:null,heard:''});this.#startFollowup(generation);
  }catch(error){
   if(error instanceof GuardIgnored&&generation===this.#generation){
    outcome='cancelled';this.#stopWatching();this.#listeningSince=performance.now();try{this.listener.setListening?.(true);}catch{}this.#set({state:'LISTENING',speechSession:null,heard:'',reply:''});this.#startFollowup(generation);return;
   }
   outcome=abort.signal.aborted||generation!==this.#generation?'cancelled':'failed';
   await this.speech.cancelTurn().catch(()=>{});
   if(generation===this.#generation&&outcome==='failed'){
    // A failed reply returns to listening rather than ending the conversation.
    this.#stopWatching();this.#listeningSince=performance.now();try{this.listener.setListening?.(true);}catch{}this.#set({state:'LISTENING',speechSession:null,error:'That reply did not finish. Try saying it again.'});this.#startFollowup(generation);
   }
  }finally{
   profiler.finish(outcome);if(generation===this.#generation)this.#set({trace:profiler.snapshot()});
   if(this.#turnAbort===abort)this.#turnAbort=null;
   this.server.scheduleIdle();
  }
 }
 /** Speaks a short announcement (a due reminder). During a conversation it waits for the current reply, pauses
  * listening while it talks, then resumes. Otherwise it warms the voice, speaks, and unloads the voice again.
  * Announcements queue; STOP or ending the conversation cancels them.
  */
 announce(text:string):Promise<void>{
  const spoken=text.replace(/\s+/g,' ').trim().slice(0,400);if(!spoken)return Promise.resolve();
  const signal=this.#announceAbort.signal;
  const run=this.#announceQueue.then(()=>this.#speakAnnouncement(spoken,signal)).catch(()=>{});
  this.#announceQueue=run;return run;
 }
 async #speakAnnouncement(text:string,signal:AbortSignal){
  signal.throwIfAborted();
  this.#announcing++;this.#notify();
  const conversation=this.#active?this.#generation:null;let wasWaiting=false;
  try{
   if(conversation!==null){
    // Let the reply in progress finish first.
    for(let i=0;i<40&&this.#turnTask;i++)await Promise.race([this.#turnTask.catch(()=>{}),new Promise(r=>setTimeout(r,500))]);
    signal.throwIfAborted();if(this.#generation!==conversation||!['LISTENING','WAITING'].includes(this.#status.state))throw new Error('Conversation changed');
    wasWaiting=this.#status.state==='WAITING';this.#clearFollowup();this.#interruptedAnnouncement=false;
    try{this.listener.setListening?.(false);}catch{}
    if(wasWaiting)try{this.listener.setWakeWait?.(false);}catch{}
    this.#interruptIgnore.clear();this.#watchInterrupts();this.#watchInterrupts(text);
    this.#set({state:'SPEAKING'});
   }
   const own=new AbortController();this.#announcementAbort=own;
   const limit=AbortSignal.any([signal,own.signal,AbortSignal.timeout(90000)]);
   const fail=new Promise<never>((_,reject)=>limit.addEventListener('abort',()=>reject(new Error('Announcement stopped')),{once:true}));fail.catch(()=>{});
   await Promise.race([this.speech.prepare(),fail]);signal.throwIfAborted();
   const turn=this.speech.begin({firstAudio(){},playbackStarted(){}});
   this.#set({announcement:text,speechSession:turn.id});
   turn.push(text);turn.finish();
   await Promise.race([turn.done,fail]);
  }catch{
   await this.speech.cancelTurn().catch(()=>{});
  }finally{
   this.#announcing--;
   if(conversation!==null&&this.#generation===conversation&&this.#active&&this.#interruptedAnnouncement){
    // Cut off by "stop"/"Harmony": the interrupt already switched to listening.
    this.#interruptedAnnouncement=false;
   }else if(conversation!==null&&this.#generation===conversation&&this.#active){
    this.#stopWatching();this.#set({speechSession:null,announcement:null});
    if(wasWaiting)this.#enterWaiting();
    else{this.#listeningSince=performance.now();try{this.listener.setListening?.(true);}catch{}this.#set({state:'LISTENING'});this.#startFollowup(conversation);}
   }else{
    this.#set({speechSession:null,announcement:null});
    // Free the CPU when no conversation needs the voice.
    if(!this.#active&&!this.#stopping&&this.#announcing===0)await this.speech.stop().catch(()=>{});
   }
  }
 }
 /** Ends the conversation: stops listening and cancels any reply, waiting for both. The voice worker is unloaded too,
  * unless keepVoice (an ordinary "end conversation"): then an idle voice stays loaded (it uses no CPU while idle) so the
  * next conversation starts without reloading it. STOP and errors always unload it. */
 stop(options:{keepVoice?:boolean}={}):Promise<void>{
  if(this.#stopping)return this.#stopping;
  this.#generation++;this.#announceAbort.abort();this.#announceAbort=new AbortController();this.#clearFollowup();
  const wasActive=this.#active||this.speech.active;this.#active=false;this.#history=[];
  this.listener.setTranscriptListener(null);this.#turnAbort?.abort();
  if(!wasActive){return Promise.resolve();}
  this.#set({state:'STOPPING',speechSession:null});
  this.#stopping=(async()=>{
   // Warm-up is cancelled by the abort above; the voice worker's own stop waits for its preparation.
   const results=await Promise.allSettled([this.listener.stop(),options.keepVoice?this.speech.cancelTurn():this.speech.stop(),this.#turnTask??Promise.resolve()]);
   this.server.scheduleIdle();
   if(results.some(r=>r.status==='rejected')){this.#set({state:'ERROR',error:'Conversation shutdown could not be verified.'});throw new Error('Conversation shutdown unverified');}
   this.#set({state:'OFF',speechSession:null,heard:''});
  })().finally(()=>{this.#stopping=null;this.#notify();});
  return this.#stopping;
 }
}
