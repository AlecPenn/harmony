import {SourceList} from './SourceList.tsx';
import {useEffect,useRef,useState,type RefObject} from 'react';
import type {ConversationStatus} from '../../../packages/contracts/conversation.ts';
import type {LocalCapture} from './local-capture.ts';
import type {VoicePlayback} from './voice-playback.ts';

/** Hide markdown markers (**bold**, `code`, # headings) the model sometimes emits; the text itself is unchanged. */
const plain=(text:string)=>text.replace(/\*\*|__|`/g,'').replace(/^\s*#{1,6}\s+/gm,'');

const caption:Record<ConversationStatus['state'],string>={
 OFF:'',STARTING:'Waking up the brain and voice…',WAITING:'Say “Harmony” when you need me.',LISTENING:'Listening. Just talk.',THINKING:'Thinking…',SPEAKING:'Speaking…',STOPPING:'Ending conversation…',ERROR:''
};

/** Talk to HARMONY with your voice. Everything runs on this PC. */
export function ConversationBar({status,system,capture,playback,recognizer}:{status?:ConversationStatus;system:string;capture:RefObject<LocalCapture|null>;playback:RefObject<VoicePlayback|null>;recognizer?:string|null}){
 const [pending,setPending]=useState(false);
 const played=useRef<string|null>(null);
 const state=status?.state??'OFF';
 const on=!['OFF','ERROR'].includes(state);
 // Play each spoken reply as soon as the core opens it.
 useEffect(()=>{
  const id=status?.speechSession??null;
  if(id&&id!==played.current){played.current=id;void playback.current?.attach(id);}
  // The core closed the reply (finished, cut off or cancelled): stop any audio still queued, immediately.
  if(!id){if(played.current)playback.current?.silence();played.current=null;}
 },[status?.speechSession,playback]);
 useEffect(()=>{if(!on)playback.current?.silence();},[on,playback]);
 async function start(handsFree=false){setPending(true);try{await capture.current?.start(handsFree?'hands-free':'conversation');}finally{setPending(false);}}
 async function end(){setPending(true);try{playback.current?.silence();await capture.current?.stop();await window.harmony?.conversationStop();}catch{}finally{setPending(false);}}
 const t=status?.timing;
 return <div className="conversation-bar" aria-live="polite">
  {!on&&<div className="talk-options"><button className="primary talk-button" disabled={pending||system!=='PASSIVE'} onClick={()=>void start()}>🎙 Talk to HARMONY</button>
   <button className="text-button" disabled={pending||system!=='PASSIVE'} title="Microphone stays on and listens only for the word Harmony. Nothing leaves this PC." onClick={()=>void start(true)}>Hands-free · say “Harmony”</button></div>}
  {on&&<button className="text-button" disabled={pending||state==='STOPPING'} onClick={()=>void end()}>{status?.handsFree?'Turn off hands-free':'End conversation'}</button>}
  {on&&<p className="conversation-state" role="status" title={status?.voiceLabel}>{status?.announcement?'Reminder…':state==='LISTENING'&&status?.transcribing?'Got it, one sec…':caption[state]}</p>}
  {on&&!!status?.heard&&<p className="conversation-heard"><span>You:</span> {status.heard}</p>}
  {on&&!!status?.reply&&<p className="conversation-reply"><span>HARMONY:</span> {plain(status.reply)}</p>}
  {on&&<SourceList sources={status?.sources}/>}
  {on&&status?.startup?.totalMs!=null&&<p className="conversation-timing">Ready in {(status.startup.totalMs/1000).toFixed(1)} s · speech {((status.startup.speechMs??0)/1000).toFixed(1)} · brain {((status.startup.brainMs??0)/1000).toFixed(1)} · voice {((status.startup.voiceMs??0)/1000).toFixed(1)}</p>}
  {status?.error&&<p role="alert">{status.error}</p>}
  {on&&t?.playbackStartMs!=null&&<p className="conversation-timing">After you stopped talking: understood {t.sttMs??'?'} ms · first words {t.firstWordsMs??'?'} ms · <strong>voice {t.playbackStartMs} ms</strong></p>}
  {on&&state==='SPEAKING'&&<p className="conversation-hint">Say “stop” or “Harmony” to cut in</p>}
  {on&&<p className="conversation-note">{recognizer==='parakeet'?'Hearing with Parakeet':recognizer==='whisper'?'Hearing with Whisper':'Speech recognition starting'} · Scottish-accented test voice · private, on this PC · say “stop” to cut it off</p>}
 </div>;
}
