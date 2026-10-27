export type LocalVoiceEngine='kokoro'|'piper';
export function validateLocalVoiceEngine(value:unknown):asserts value is LocalVoiceEngine{if(value!=='kokoro'&&value!=='piper')throw new Error('Unsupported local voice');}
export const voicePresets=['natural','relaxed','brisk'] as const;
export type VoicePreset=typeof voicePresets[number];
export interface VoicePreparation {stage:'model'|'acknowledgements'|'warmup'|'ready';elapsedMs:number;}
export interface VoiceOutputStatus {
  preparation?:VoicePreparation[];
  provider?:'azure'|'local'; localEngine?:LocalVoiceEngine;
  state:'IDLE'|'PREPARING'|'READY'|'STARTING'|'STREAMING'|'PLAYING'|'FINISHED'|'CANCELLED'|'ERROR';
  preset:VoicePreset; tts_first_audio_ms:number|null; playback_start_ms:number|null; error:string|null;
}
export const emptyVoiceOutput:VoiceOutputStatus={state:'IDLE',preset:'natural',tts_first_audio_ms:null,playback_start_ms:null,error:null};
export interface VoiceChunk {samples:Int16Array;rate:24000|22050;done:boolean}
export function validatePreset(value:unknown):asserts value is VoicePreset {
  if(!voicePresets.includes(value as VoicePreset))throw new Error('Unsupported voice preset');
}
export function validateVoiceRequest(id:unknown,sequence:unknown):asserts id is string {
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(sequence)||(sequence as number)<0)throw new Error('Invalid voice request');
}
