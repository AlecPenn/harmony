/** Real-brain check (October 27): runs evals/brain-cases.ts through HARMONY's actual brain, with her actual prompt
 * (instructions, all functions, a sample memory), and scores whether she chose the right function with sensible
 * arguments. Run on the PC with HARMONY closed (the GPU holds one copy of the model):
 *     node --experimental-strip-types scripts/brain-check.ts
 * Writes .runtime/brain-check.json and a readable .runtime/brain-check.txt. Nothing is sent anywhere. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import * as A from '../core/assistant-actions.ts';
import {LocalModelServer,localModelRoot,readLocalInstall} from '../core/local-model.ts';
import {LocalChatClient,type ModelTool} from '../packages/reasoning/local-chat.ts';
import {withTime} from '../packages/reasoning/time-context.ts';
import {CASES,CONTEXT} from '../evals/brain-cases.ts';

const root=resolve(import.meta.dirname,'..');
const TOOLS:ModelTool[]=[...A.reminderModelTools,A.statusModelTool,A.modeModelTool,...A.memoryModelTools,A.recallModelTool,...A.projectModelTools,
 ...Object.values(A.desktopModelTools),A.workspaceModelTool,...A.webModelTools,A.researchModelTool,A.godsEyeModelTool,A.workModelTool,
 ...Object.values(A.googleModelTools),A.skillsModelTool];

const server=new LocalModelServer(()=>readLocalInstall(localModelRoot(root)));
const chat=new LocalChatClient();
const abort=new AbortController();
const out:{case:string;want:readonly string[];got:{name:string;arguments:Record<string,string>}[];text:string;ok:boolean;why:string;ms:number;note?:string}[]=[];
try{
 const started=performance.now();const endpoint=await server.ensure(abort.signal);const loadMs=Math.round(performance.now()-started);
 const w=performance.now();await chat.warm(endpoint,{tools:TOOLS,context:CONTEXT,signal:abort.signal});const warmMs=Math.round(performance.now()-w);
 console.log(`Brain loaded in ${loadMs} ms; prompt start read in ${warmMs} ms. ${CASES.length} cases...`);
 for(const c of CASES){
  const t=performance.now();let text='';
  for await(const e of chat.stream(endpoint,{text:withTime(c.say),maxOutputTokens:160,signal:abort.signal,history:[],tools:TOOLS,context:CONTEXT}))if(e.type==='text')text+=e.text;
  const ms=Math.round(performance.now()-t),got=A.parseToolCalls(text);
  const names=got.map(g=>g.name),want=c.tools.filter(Boolean),noneOk=c.tools.length===0||c.tools.includes('');
  let ok:boolean,why='';
  if(!got.length){ok=noneOk;if(!ok)why=`no function (wanted ${want.join(' or ')})`;}
  else if(!want.length){ok=false;why=`called ${names.join(', ')} (should just answer)`;}
  else{
   const hit=got.find(g=>want.includes(g.name));
   ok=!!hit&&got.length<=(c.say.match(/\band\b/)?2:1);
   if(!hit)why=`called ${names.join(', ')} (wanted ${want.join(' or ')})`;
   else{
    for(const [k,re] of Object.entries(c.args??{})){const v=hit.arguments[k]??'';if(!re.test(v)){ok=false;why=`${k}="${v.slice(0,60)}" doesn't match ${re}`;break;}}
    if(ok&&got.length>1&&!c.say.match(/\band\b/)){ok=false;why=`extra calls: ${names.join(', ')}`;}
   }
  }
  out.push({case:c.say,want:c.tools,got,text:text.replace(/<tool_call>[\s\S]*/,'').trim().slice(0,200),ok,why,ms,...(c.note?{note:c.note}:{})});
  console.log(`${ok?'PASS':'FAIL'} ${String(ms).padStart(5)} ms  ${c.say}${ok?'':`  ->  ${why}`}`);
 }
 const passed=out.filter(o=>o.ok).length,times=out.map(o=>o.ms).sort((a,b)=>a-b);
 const summary={at:new Date().toISOString(),model:endpoint.model,loadMs,warmMs,passed,total:out.length,percent:Math.round(100*passed/out.length),medianMs:times[Math.floor(times.length/2)],slowestMs:times.at(-1)};
 mkdirSync(join(root,'.runtime'),{recursive:true});
 writeFileSync(join(root,'.runtime','brain-check.json'),JSON.stringify({summary,cases:out},null,1));
 writeFileSync(join(root,'.runtime','brain-check.txt'),[`HARMONY brain check, ${summary.at}`,`${passed}/${out.length} right (${summary.percent}%), median ${summary.medianMs} ms per request (warm), load ${loadMs} ms, prompt start ${warmMs} ms`,'',
  ...out.map(o=>`${o.ok?'PASS':'FAIL'} ${o.case}${o.ok?'':`\n     ${o.why}${o.text?`\n     she said: ${o.text}`:''}`}`)].join('\n'));
 console.log(`\n${passed}/${out.length} right (${summary.percent}%). Details in .runtime\\brain-check.txt`);
}finally{await server.stop().catch(()=>{});}
