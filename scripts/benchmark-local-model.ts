/** Measures the installed local model (or a candidate GGUF) on this PC with HARMONY's real client.
 * Reports cold load, first-words latency and generation speed for fixed assistant-style prompts.
 * Usage: node scripts/benchmark-local-model.ts [--gguf path\to\candidate.gguf] [--runs 3] [--ctx 4096] [--gpu-layers 99|auto]
 * Results print to the console and are saved under data/local-model-benchmarks/ (ignored by git).
 */
import {mkdirSync,writeFileSync,statSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {LocalModelServer,localModelRoot,readLocalInstall} from '../core/local-model.ts';
import {LocalChatClient} from '../packages/reasoning/local-chat.ts';

const root=resolve(import.meta.dirname,'..');
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
const runs=Number(arg('--runs')??3);if(!Number.isSafeInteger(runs)||runs<1||runs>10)throw new Error('--runs must be 1-10');
const installed=readLocalInstall(localModelRoot(root));if(!installed)throw new Error('Run "Set up local brain" first; the engine is needed even to test a candidate model.');
const candidate=arg('--gguf');
const install=candidate?{...installed,modelPath:resolve(candidate),modelId:basename(candidate).replace(/\.gguf$/i,'').replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,120),modelName:basename(candidate)}:installed;
if(candidate&&!statSync(install.modelPath).isFile())throw new Error('Candidate model file not found');

const prompts=[
 'Remind me what a good morning routine looks like in three short points.',
 'In one sentence, what is the difference between weather and climate?',
 'I have a dentist appointment at 3 and need to pick up my kids at 4:30. Is that tight? Answer briefly.',
 'Tell me a quick, clean joke about computers.',
 'Explain what a GPU does to a ten-year-old in two sentences.'
];
const ctx=Number(arg('--ctx')??4096),layers=arg('--gpu-layers')??'99';
if(!Number.isSafeInteger(ctx)||ctx<512||ctx>32768)throw new Error('--ctx must be 512-32768');
const server=new LocalModelServer(()=>install,()=>{},undefined,undefined,{contextTokens:ctx,gpuLayers:layers==='auto'?'auto':Number(layers)});
console.log(`Context ${ctx} tokens · GPU layers ${layers}`);const client=new LocalChatClient();
const results:{prompt:number;firstWordsMs:number;tokensPerSecond:number|null;outputTokens:number|null;totalMs:number}[]=[];
try{
 const loadStart=performance.now();const endpoint=await server.ensure(new AbortController().signal);const coldLoadMs=Math.round(performance.now()-loadStart);
 console.log(`Model: ${install.modelName}\nCold load: ${(coldLoadMs/1000).toFixed(1)} s`);
 for(let run=0;run<runs;run++)for(const [index,text] of prompts.entries()){
  const start=performance.now();let first:number|null=null,outputTokens:number|null=null;
  for await(const event of client.stream(endpoint,{text,maxOutputTokens:256,signal:new AbortController().signal})){
   if(event.type==='text'&&first===null)first=performance.now();
   if(event.type==='completed')outputTokens=event.outputTokens;
  }
  const end=performance.now();if(first===null)throw new Error('No text produced');
  const tokensPerSecond=outputTokens&&end>first?Math.round(outputTokens/((end-first)/1000)*10)/10:null;
  results.push({prompt:index,firstWordsMs:Math.round(first-start),tokensPerSecond,outputTokens,totalMs:Math.round(end-start)});
  console.log(`run ${run+1} prompt ${index+1}: first words ${Math.round(first-start)} ms, ${tokensPerSecond??'?'} tokens/s`);
 }
 const median=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
 const summary={model:install.modelName,modelId:install.modelId,contextTokens:ctx,gpuLayers:layers,date:new Date().toISOString(),coldLoadMs,runs,
  medianFirstWordsMs:median(results.map(r=>r.firstWordsMs)),medianTokensPerSecond:median(results.flatMap(r=>r.tokensPerSecond===null?[]:[r.tokensPerSecond])),results,
  note:'One machine, one session. Quality is not scored here; read the answers yourself before switching models.'};
 console.log(`\nMedian first words: ${summary.medianFirstWordsMs} ms · median speed: ${summary.medianTokensPerSecond} tokens/s`);
 const out=join(root,'data','local-model-benchmarks');mkdirSync(out,{recursive:true});
 const file=join(out,`${install.modelId}-${Date.now()}.json`);writeFileSync(file,JSON.stringify(summary,null,1));console.log(`Saved ${file}`);
}finally{await server.stop();}
