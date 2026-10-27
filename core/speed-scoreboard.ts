import type {DatabaseSync} from 'node:sqlite';
import type {TurnTimings} from './diagnostics.ts';

/** Step 23: the speed scoreboard. Every spoken reply's timings are kept on this PC (no words, only milliseconds), tagged
 * with the build that made it, so each speed pass can be judged by numbers: medians and the slow tail (90th
 * percentile) per build, against the targets in ROADMAP.md, and the change from the build before. */

export type TurnKind='instant'|'shortcut'|'brain'|'lookup'|'guest';
export const TARGETS:Record<TurnKind|'startup',{metric:string;ms:number;label:string}>={
 instant:{metric:'firstAudioMs',ms:500,label:'exact commands: sound under 0.5 s'},
 shortcut:{metric:'firstAudioMs',ms:500,label:'exact commands: sound under 0.5 s'},
 brain:{metric:'firstAudioMs',ms:1200,label:'short replies: first audio under 1.2 s'},
 lookup:{metric:'firstWordsMs',ms:2500,label:'lookups: first words under 2.5 s'},
 guest:{metric:'firstAudioMs',ms:1200,label:'guest replies: first audio under 1.2 s'},
 startup:{metric:'totalMs',ms:5000,label:'start to ready under 5 s'},
};
export interface BuildScore {build:string;from:string;to:string;n:number;
 kinds:Partial<Record<TurnKind,{n:number;median:number|null;p90:number|null;target:number;met:number}>>;
 stages:{stt:number|null;brain:number|null;voice:number|null;tool:number|null};startup:{n:number;median:number|null};}
export interface Scoreboard {builds:BuildScore[];summary:string;}
const KEEP=3000;

export function quantile(xs:readonly number[],q:number):number|null{
 if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);const i=(s.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);
 return Math.round(s[lo]+(s[hi]-s[lo])*(i-lo));
}
export function classify(t:{fixed:boolean;shortcut:boolean;guest:boolean;toolMs:number|null}):TurnKind{
 return t.fixed?'instant':t.guest?'guest':t.shortcut?'shortcut':t.toolMs!==null?'lookup':'brain';
}
export class SpeedScoreboard {
 private db:DatabaseSync;private build:()=>string|null;private now:()=>Date;
 constructor(db:DatabaseSync,build:()=>string|null,now:()=>Date=()=>new Date()){this.db=db;this.build=build;this.now=now;}
 record(t:TurnTimings,kind:TurnKind){
  const ok=(v:number|null)=>v===null||!Number.isFinite(v)||v<0||v>600000?null:Math.round(v);
  this.db.prepare('INSERT INTO speed_turns (at,build,kind,stt_ms,first_words_ms,first_audio_ms,tool_ms) VALUES (?,?,?,?,?,?,?)')
   .run(this.now().toISOString(),(this.build()??'unknown').slice(0,12),kind,ok(t.sttMs),ok(t.firstWordsMs),ok(t.firstAudioMs),ok(t.toolMs));
  this.db.prepare('DELETE FROM speed_turns WHERE id <= (SELECT max(id) FROM speed_turns) - ?').run(KEEP);
 }
 startup(totalMs:number|null){
  if(totalMs===null||!Number.isFinite(totalMs)||totalMs<0||totalMs>600000)return;
  this.db.prepare("INSERT INTO speed_turns (at,build,kind,stt_ms,first_words_ms,first_audio_ms,tool_ms) VALUES (?,?,'startup',NULL,?,NULL,NULL)").run(this.now().toISOString(),(this.build()??'unknown').slice(0,12),Math.round(totalMs));
 }
 scores(maxBuilds=6):BuildScore[]{
  const rows=this.db.prepare('SELECT * FROM speed_turns ORDER BY id').all() as {at:string;build:string;kind:string;stt_ms:number|null;first_words_ms:number|null;first_audio_ms:number|null;tool_ms:number|null}[];
  const order:string[]=[];for(const r of rows)if(!order.includes(r.build))order.push(r.build);
  return order.slice(-maxBuilds).map(build=>{
   const mine=rows.filter(r=>r.build===build),turns=mine.filter(r=>r.kind!=='startup');
   const kinds:BuildScore['kinds']={};
   for(const k of ['instant','shortcut','brain','lookup','guest'] as TurnKind[]){
    const target=TARGETS[k],xs=turns.filter(r=>r.kind===k).map(r=>target.metric==='firstWordsMs'?r.first_words_ms:r.first_audio_ms).filter((v):v is number=>v!==null);
    if(xs.length)kinds[k]={n:xs.length,median:quantile(xs,.5),p90:quantile(xs,.9),target:target.ms,met:Math.round(xs.filter(x=>x<=target.ms).length/xs.length*100)};
   }
   const med=(f:(r:typeof rows[number])=>number|null)=>quantile(turns.map(f).filter((v):v is number=>v!==null&&v>=0),.5);
   const st=mine.filter(r=>r.kind==='startup').map(r=>r.first_words_ms!).filter(v=>v!==null);
   return {build,from:mine[0].at,to:mine.at(-1)!.at,n:turns.length,kinds,
    stages:{stt:med(r=>r.stt_ms),brain:med(r=>r.first_words_ms!==null&&r.stt_ms!==null?r.first_words_ms-r.stt_ms-(r.tool_ms??0):null),voice:med(r=>r.first_audio_ms!==null&&r.first_words_ms!==null?r.first_audio_ms-r.first_words_ms:null),tool:med(r=>r.tool_ms)},
    startup:{n:st.length,median:quantile(st,.5)}};
  });
 }
 /** Spoken: how this build is doing against the targets, and against the build before. */
 board():Scoreboard{
  const builds=this.scores(),cur=builds.at(-1),prev=builds.at(-2);
  if(!cur||!cur.n)return {builds,summary:'No timed replies yet on this build. Talk to me for a bit and ask again.'};
  const s=(ms:number|null)=>ms===null?'?':`${(ms/1000).toFixed(1)} s`,parts:string[]=[];
  const b=cur.kinds.brain,l=cur.kinds.lookup;
  if(b)parts.push(`Short replies: first audio ${s(b.median)} typical, ${s(b.p90)} at the slow end, ${b.met}% under the 1.2 s target`);
  if(l)parts.push(`lookups: first words ${s(l.median)} typical, ${l.met}% under 2.5 s`);
  // Among the stages every reply goes through (lookup time only applies to lookups, so it isn't compared here).
  const slowest=Object.entries(cur.stages).filter(([k,v])=>k!=='tool'&&v!==null).sort((x,y)=>(y[1] as number)-(x[1] as number))[0];
  if(slowest)parts.push(`the slowest stage is ${({stt:'transcribing what you said',brain:'the brain thinking',voice:'the voice starting'} as Record<string,string>)[slowest[0]]} at ${s(slowest[1] as number)}`);
  let vs='';
  if(prev?.kinds.brain?.median&&b?.median){const d=Math.round((b.median-prev.kinds.brain.median)/prev.kinds.brain.median*100);vs=d<=-3?` That's ${-d}% faster than the build before.`:d>=3?` That's ${d}% slower than the build before.`:' About the same as the build before.';}
  return {builds,summary:`Speed on this build (${cur.n} replies): ${parts.join('; ')}.${vs}${cur.startup.median!==null?` Start to ready: ${s(cur.startup.median)}.`:''}`};
 }
}
export const SPEED_MIGRATION=`CREATE TABLE speed_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, build TEXT NOT NULL CHECK(length(build) <= 12),
    kind TEXT NOT NULL CHECK(kind IN ('instant','shortcut','brain','lookup','guest','startup')),
    stt_ms INTEGER, first_words_ms INTEGER, first_audio_ms INTEGER, tool_ms INTEGER
  );
  CREATE INDEX speed_turns_build ON speed_turns(build, id);`;
