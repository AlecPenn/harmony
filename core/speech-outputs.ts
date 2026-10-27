import {VoiceOutput} from './voice-output.ts';
import {LocalVoicePreview} from './local-voice-preview.ts';
import type {VoiceConnection} from '../packages/contracts/voice-connection.ts';
import type {VoicePreset,LocalVoiceEngine} from '../packages/contracts/voice-output.ts';
export class SpeechOutputs {
 #azure:VoiceOutput;#local:LocalVoicePreview;#mode:'azure'|'local'='azure';#generation=0;#engine:LocalVoiceEngine='kokoro';
 constructor(root:string,changed:()=>void,private makeLocal:(engine:LocalVoiceEngine)=>LocalVoicePreview=engine=>new LocalVoicePreview(root,changed,undefined,engine)){this.#azure=new VoiceOutput(root,changed);this.#local=this.makeLocal('kokoro');}
 get #current(){return this.#mode==='local'?this.#local:this.#azure;}
 get active(){return this.#azure.active||this.#local.active;}
 get generation(){return this.#generation+this.#azure.generation+this.#local.generation;}
 snapshot(){return this.#current.snapshot();}trace(){return this.#current.trace();}
 start(preset:VoicePreset,connection:VoiceConnection){if(this.active)throw new Error('Stop the active voice first');this.#mode='azure';this.#generation++;return this.#azure.start(preset,connection);}
 #select(engine:LocalVoiceEngine){if(engine===this.#engine)return;if(this.#local.active)throw new Error('Stop local voice before switching engines');this.#generation+=this.#local.generation+1;this.#local=this.makeLocal(engine);this.#engine=engine;}
 prepareLocal(engine:LocalVoiceEngine='kokoro'){this.#select(engine);if(this.#azure.active||this.#local.busy)return Promise.reject(new Error('Stop the active voice first'));this.#mode='local';this.#generation++;return this.#local.prepare();}
 startLocal(engine:LocalVoiceEngine='kokoro'){this.#select(engine);if(this.#azure.active||this.#local.busy)throw new Error('Stop the active voice first');this.#mode='local';this.#generation++;return this.#local.start();}
 next(id:string,sequence:number){return this.#current.next(id,sequence);}
 playback(id:string,finished:boolean){return this.#current.playback(id,finished);}
 async stop(){const results=await Promise.allSettled([this.#azure.stop(),this.#local.stop()]);if(results.some(r=>r.status==='rejected'))throw new Error('Speech shutdown unverified');}
}
