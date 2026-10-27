export interface AudioStatus {
  state: 'OFF' | 'STARTING' | 'READY' | 'CAPTURING' | 'STOPPING' | 'ERROR';
  receivedFrames: number;
  vadMs: number | null;
  transcript: string;
  transcriptFinal: boolean;
  sttMs: number | null;
  error: string | null;
  mode: 'test' | 'wake' | 'conversation' | null;
  /** Speech recognizer the worker reported at startup. */
  engine?: 'whisper' | 'parakeet' | 'vad' | null;
  wakeCount: number;
  wakeCandidateCount: number;
  wakeConfidence: number | null;
  wakeDetectorMs: number | null;
}
/** One or more consecutive 512-sample frames (a batch of up to 16 when the sender has fallen behind). sequence is the first frame's number. */
export interface AudioFrame { sessionId: string; sequence: number; samples: Int16Array }
export const FRAME_SAMPLES=512, MAX_BATCH_FRAMES=32;
export const emptyAudio: AudioStatus = { state:'OFF', receivedFrames:0, vadMs:null, transcript:'', transcriptFinal:false, sttMs:null, error:null, mode:null, wakeCount:0, wakeCandidateCount:0, wakeConfidence:null, wakeDetectorMs:null };
export function validateAudioFrame(value: unknown): asserts value is AudioFrame {
  if(!value || typeof value!=='object') throw new Error('Invalid audio frame');
  const v=value as AudioFrame;
  if(Object.keys(v).sort().join(',')!=='samples,sequence,sessionId' || typeof v.sessionId!=='string' || v.sessionId.length>64 || !Number.isSafeInteger(v.sequence) || v.sequence<0 || !(v.samples instanceof Int16Array) || v.samples.length<FRAME_SAMPLES || v.samples.length>FRAME_SAMPLES*MAX_BATCH_FRAMES || v.samples.length%FRAME_SAMPLES!==0) throw new Error('Invalid audio frame');
}
export function audioPermission(owner:boolean, mainFrame:boolean, exactDocument:boolean, armed:boolean, kinds:readonly string[]):boolean {
  return owner && mainFrame && exactDocument && armed && kinds.length===1 && kinds[0]==='audio';
}
