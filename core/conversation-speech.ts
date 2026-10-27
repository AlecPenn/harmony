import {randomUUID} from 'node:crypto';
import {LocalVoice,launchPiper} from './local-voice.ts';
import {voiceLookahead} from './voice-lookahead.ts';
import type {VoiceChunk} from '../packages/contracts/voice-output.ts';

type Worker=Pick<LocalVoice,'active'|'ready'|'start'|'speak'|'stop'>;
export interface SpeechTurnHooks {firstAudio():void;playbackStarted():void;}
export interface SpeechTurn {readonly id:string;push(text:string):void;finish():void;readonly done:Promise<void>;}
interface Turn {id:string;queue:string[];finished:boolean;cancelled:boolean;waiters:(()=>void)[];reader:AsyncGenerator<VoiceChunk>;abort:AbortController;
 sequence:number;pending:boolean;complete:boolean;firstAudio:boolean;playing:boolean;inPhrase:boolean;hooks:SpeechTurnHooks;
 resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;}

const RATE=22050;
/** Strip formatting a model may emit so it is not read aloud ("asterisk asterisk"). Display text is unaffected. */
export function speakable(text:string):string{
 const cleaned=text.replace(/```[\s\S]*?```/g,' ').replace(/`([^`]*)`/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
  .replace(/^\s*(?:[-*•]|\d+[.)]|#{1,6})\s+/gm,'').replace(/[*_#>~|]/g,'')
  // Emoji and pictographs cannot be pronounced; a phrase of only emoji made Piper produce no audio and fail the reply.
  .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu,'').replace(/\s+/g,' ').trim();
 // Only text with at least one letter or digit is sent to the voice.
 return /[\p{L}\p{N}]/u.test(cleaned)?cleaned:'';
}

/** Speaks model text phrase-by-phrase through the resident Piper worker while more text is still arriving.
 * The chamber pulls validated PCM with next()/playback(); one turn at a time. Cancelling a turn mid-phrase
 * stops the worker (native inference cannot be interrupted), so the next turn re-warms it.
 */
export class ConversationSpeech {
 #worker:Worker;#session:string|null=null;#turn:Turn|null=null;#preparing:Promise<void>|null=null;
 constructor(root:string,worker?:Worker,private turnLimitMs=180000){
  this.#worker=worker??new LocalVoice(root,launchPiper,()=>{this.#session=null;},RATE);
 }
 get active(){return this.#worker.active||this.#turn!==null||this.#preparing!==null;}
 get speaking(){return this.#turn!==null;}
 owns(id:unknown){return typeof id==='string'&&this.#turn?.id===id;}
 prepare():Promise<void>{
  if(this.#worker.ready&&this.#session)return Promise.resolve();
  if(this.#preparing)return this.#preparing;
  this.#preparing=this.#worker.start().then(result=>{this.#session=result.session;}).finally(()=>{this.#preparing=null;});
  return this.#preparing;
 }
 begin(hooks:SpeechTurnHooks):SpeechTurn{
  if(this.#turn)throw new Error('A spoken reply is already in progress');
  const id=randomUUID(),abort=new AbortController();
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const done=new Promise<void>((ok,fail)=>{resolve=ok;reject=fail;});done.catch(()=>{});
  const turn:Turn={id,queue:[],finished:false,cancelled:false,waiters:[],abort,sequence:0,pending:false,complete:false,firstAudio:false,playing:false,inPhrase:false,hooks,resolve,reject,
   reader:null as unknown as AsyncGenerator<VoiceChunk>,timer:setTimeout(()=>{if(this.#turn===turn)void this.cancelTurn();},this.turnLimitMs)};
  turn.reader=voiceLookahead(this.#read(turn),abort.signal);
  this.#turn=turn;
  const wake=()=>{for(const w of turn.waiters.splice(0))w();};
  return {id,done,
   push:(text:string)=>{
    if(this.#turn!==turn||turn.finished)return;
    const spoken=speakable(text);if(!spoken)return;
    // Phrases are already bounded upstream; the worker also enforces its own 1,000-character limit.
    turn.queue.push(spoken.slice(0,1000));wake();
   },
   finish:()=>{if(this.#turn===turn){turn.finished=true;wake();}}};
 }
 async *#read(turn:Turn):AsyncGenerator<VoiceChunk>{
  while(true){
   if(turn.cancelled)throw new Error('Spoken reply cancelled');
   if(turn.queue.length){
    const text=turn.queue.shift()!;
    if(!this.#session)await this.prepare();
    if(turn.cancelled||!this.#session)throw new Error('Spoken reply cancelled');
    turn.inPhrase=true;
    try{
     for await(const samples of this.#worker.speak(this.#session,text)){
      if(turn.cancelled)throw new Error('Spoken reply cancelled');
      yield {samples,rate:RATE,done:false};
     }
    }finally{turn.inPhrase=false;}
    continue;
   }
   if(turn.finished){yield {samples:new Int16Array(),rate:RATE,done:true};return;}
   await new Promise<void>(wake=>turn.waiters.push(wake));
  }
 }
 async next(id:string,sequence:number):Promise<VoiceChunk>{
  const turn=this.#turn;
  if(!turn||id!==turn.id||sequence!==turn.sequence||turn.pending)throw new Error('Spoken reply session unavailable');
  turn.pending=true;
  try{
   const value=await turn.reader.next();
   if(this.#turn!==turn||value.done)throw new Error('Spoken reply cancelled');
   turn.sequence++;
   if(value.value.done)turn.complete=true;
   else if(!turn.firstAudio){turn.firstAudio=true;try{turn.hooks.firstAudio();}catch{}}
   return value.value;
  }catch(error){
   if(this.#turn===turn)await this.cancelTurn();
   throw new Error('Spoken reply unavailable');
  }finally{turn.pending=false;}
 }
 playback(id:string,finished:boolean):void{
  const turn=this.#turn;if(!turn||id!==turn.id)throw new Error('Stale spoken reply');
  if(!finished){
   if(!turn.firstAudio)throw new Error('No spoken audio ready');
   if(!turn.playing){turn.playing=true;try{turn.hooks.playbackStarted();}catch{}}
   return;
  }
  if(!turn.complete)throw new Error('Spoken reply incomplete');
  this.#end(turn);turn.resolve();
 }
 #end(turn:Turn){clearTimeout(turn.timer);if(this.#turn===turn)this.#turn=null;turn.abort.abort();void turn.reader.return(undefined).catch(()=>{});}
 /** Abandon the current spoken reply. If Piper was mid-phrase the worker is stopped, and this waits for it. */
 async cancelTurn():Promise<void>{
  const turn=this.#turn;if(!turn)return;
  turn.cancelled=true;for(const w of turn.waiters.splice(0))w();
  this.#end(turn);turn.reject(new Error('Spoken reply cancelled'));
  if(turn.inPhrase&&this.#worker.active){this.#session=null;await this.#worker.stop();}
 }
 async stop():Promise<void>{
  await this.cancelTurn();
  this.#session=null;
  await this.#preparing?.catch(()=>{});
  await this.#worker.stop();
 }
}
