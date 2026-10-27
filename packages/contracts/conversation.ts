import type {LatencyTrace} from './latency.ts';
/** Local desktop voice conversation. Explicitly started by the person at this computer; not speaker identity. */
export interface ConversationStatus {
 /** WAITING: hands-free, microphone on, only listening for the word "Harmony". */
 state:'OFF'|'STARTING'|'WAITING'|'LISTENING'|'THINKING'|'SPEAKING'|'STOPPING'|'ERROR';
 handsFree:boolean;
 /** Times HARMONY was cut off by "stop" or "Harmony" this conversation. */
 interruptions:number;
 /** What HARMONY heard most recently (partial while you speak, final once you pause). */
 heard:string;
 /** You stopped talking and HARMONY is turning your words into text. */
 transcribing:boolean;
 reply:string;
 /** Pull session for the chamber's audio player while HARMONY speaks. */
 speechSession:string|null;
 /** Final transcripts that arrived while HARMONY was thinking or speaking and were ignored (half-duplex). */
 ignoredWhileBusy:number;
 error:string|null;
 /** Per-turn timings in ms, measured from when the voice detector heard you stop (or, failing that, when the transcript arrived). */
 timing:{sttMs:number|null;firstWordsMs:number|null;firstAudioMs:number|null;playbackStartMs:number|null}|null;
 trace:LatencyTrace|null;
 voiceLabel:string;
 /** Text of an announcement (a due reminder) being spoken right now. */
 announcement:string|null;
 /** Where the current reply's web information came from (shown under the reply; never read aloud). */
 sources:{title:string;url:string;site:string}[];
 /** How long starting took, measured from the button press (ms): speech model, brain, voice, everything ready. */
 startup:{speechMs:number|null;brainMs:number|null;voiceMs:number|null;totalMs:number|null}|null;
}
export const conversationVoiceLabel='Piper Alba · Scottish-accented test voice (Australian voice still to come)';
export const emptyConversation:ConversationStatus={state:'OFF',handsFree:false,interruptions:0,heard:'',transcribing:false,reply:'',speechSession:null,ignoredWhileBusy:0,error:null,timing:null,trace:null,voiceLabel:conversationVoiceLabel,announcement:null,sources:[],startup:null};
