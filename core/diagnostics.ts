/** "Harmony, why are you slow?" — the measured timings of the last spoken reply, the slowest part, and a likely reason.
 * Only real measurements are reported; anything not measured is left out rather than guessed. */
export interface TurnTimings {sttMs:number|null;firstWordsMs:number|null;firstAudioMs:number|null;playbackStartMs:number|null;toolMs:number|null;at:string;}
export interface Startup {speechMs:number|null;brainMs:number|null;voiceMs:number|null;totalMs:number|null}
const ms=(v:number|null)=>v===null?null:Math.round(v);
export function diagnose(last:TurnTimings|null,startup:Startup|null,brainLoadMs:number|null):string{
 const lines:string[]=[];let worst:{part:string;ms:number;why:string}|null=null;
 const consider=(part:string,v:number|null,why:string)=>{if(v!==null&&v>=0&&(!worst||v>worst.ms))worst={part,ms:v,why};};
 if(last){
  const brain=last.firstWordsMs!==null&&last.sttMs!==null?last.firstWordsMs-last.sttMs-(last.toolMs??0):last.firstWordsMs;
  const voice=last.firstAudioMs!==null&&last.firstWordsMs!==null?last.firstAudioMs-last.firstWordsMs:null;
  lines.push(`Last spoken reply (${new Date(last.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}), measured from when you stopped talking:`);
  if(last.sttMs!==null)lines.push(`- Understanding your words (speech to text): ${ms(last.sttMs)} ms`);
  if(last.toolMs!==null)lines.push(`- Lookup or action: ${ms(last.toolMs)} ms`);
  if(brain!==null)lines.push(`- Brain, until the first words: ${ms(brain)} ms`);
  if(voice!==null)lines.push(`- Voice, from first words to first sound: ${ms(voice)} ms`);
  if(last.playbackStartMs!==null)lines.push(`- Total until she started speaking: ${ms(last.playbackStartMs)} ms`);
  consider('speech to text',last.sttMs,'Speech recognition runs on the CPU; long sentences take longer.');
  consider('the lookup',last.toolMs,'Web and Google lookups wait on the network.');
  consider('the brain',brain,'The local brain reads about 100 words-pieces a second, so a long instruction block, a lookup result or a cold start after the brain unloaded adds seconds.');
  consider('the voice',voice,'The voice warms up on the first sentence.');
 }else lines.push('No spoken reply has been measured yet in this session.');
 if(startup?.totalMs!=null){lines.push(`- Conversation start: ${ms(startup.totalMs)} ms (speech ${ms(startup.speechMs)??'?'}, brain ${ms(startup.brainMs)??'?'}, voice ${ms(startup.voiceMs)??'?'})`);}
 if(brainLoadMs!==null)lines.push(`- Brain load time when it last started: ${ms(brainLoadMs)} ms`);
 if(worst){const w=worst as {part:string;ms:number;why:string};lines.push(`Slowest part: ${w.part} (${ms(w.ms)} ms). ${w.why}`);}
 return lines.join('\n');
}
