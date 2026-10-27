import {expect,it} from 'vitest';
import {WakeLearner,features,sdtw,pack,unpack,MIN_POS,type Store} from '../core/wake-learner.ts';

// Synthetic "words": a voiced sound whose pitch and two formants sweep over ~0.55 s, inside 1.6 s of quiet noise.
function word(kind:'harmony'|'other'|'tv',seed:number){
 let x=seed*9301+49297;const rnd=()=>{x=(x*9301+49297)%233280;return x/233280-.5;};
 const pcm=new Int16Array(25600),start=4000+Math.floor(rnd()*3000),len=Math.floor(8800*(1+rnd()*.15)),f0=120*(1+rnd()*.06);
 for(let i=0;i<pcm.length;i++){
  let v=rnd()*300;
  if(kind==='tv'){v+=3000*Math.sin(i*2*Math.PI*(400+200*Math.sin(i/3000))/16000)*Math.sin(i/900)+rnd()*2500;}
  else if(i>=start&&i<start+len){const t=(i-start)/len,env=Math.sin(Math.PI*t);
   const [a1,a2,b1,b2]=kind==='harmony'?[700,1200,1100,2400]:[300,2300,900,900]; // formant paths differ
   const fa=a1+(a2-a1)*t,fb=b1+(b2-b1)*t,ph=2*Math.PI*f0*i/16000;
   for(let h=1;h<=20;h++){const f=f0*h,g=Math.exp(-(((f-fa)/180)**2))+.7*Math.exp(-(((f-fb)/250)**2));v+=env*9000*g*Math.sin(h*ph)/h**.3;}}
  pcm[i]=Math.max(-32767,Math.min(32767,Math.round(v)));
 }
 return pcm;
}
const memory=():Store&{data:Buffer|null}=>{const s={data:null as Buffer|null,read:async()=>s.data,write:async(d:Buffer)=>{s.data=d;},clear:async()=>{s.data=null;}};return s;};
const seal={available:async()=>true,encrypt:async(t:string)=>Buffer.from('sealed:'+t),decrypt:async(b:Buffer)=>b.toString().slice(7)};

it('features ignore the quiet around the word, and DTW tells the same word from a different one',()=>{
 const a=features(word('harmony',1))!,b=features(word('harmony',2))!,c=features(word('other',3))!;
 expect(a.length).toBeGreaterThan(40);expect(a.length).toBeLessThan(90);
 expect(features(new Int16Array(25600))).toBeNull();
 expect(sdtw(a,b)).toBeLessThan(sdtw(a,c));
 const back=unpack(pack(a));expect(back.length).toBe(a.length);expect(Math.abs(back[10][3]-a[10][3])).toBeLessThan(.07);
});
it('never blocks while learning; then learns from use, catches its own misses, and keeps the examples sealed',async()=>{
 const store=memory(),clock={t:1_000_000},L=new WakeLearner(seal,store,()=>clock.t);await L.load();
 // Learning phase: every wake is allowed.
 for(let i=0;i<4;i++)expect((await L.teach(word('harmony',10+i))).ok).toBe(true);
 const d1=L.judge(word('other',50),.95);expect(d1).toMatchObject({accept:true,reason:expect.stringMatching(/still learning/)});
 await L.outcome(d1.id,'unused');
 for(let i=0;i<4;i++){clock.t+=60000;const d=L.judge(word('harmony',20+i),.97);await L.outcome(d.id,'used');}
 for(let i=0;i<3;i++){clock.t+=60000;const d=L.judge(i===2?word('tv',60):word('other',51+i),.92);await L.outcome(d.id,i?'denied':'unused');}
 const s=L.stats();expect(s.positives).toBeGreaterThanOrEqual(MIN_POS);expect(s.negatives).toBe(4);expect(s.active).toBe(true);expect(s.falseWakes).toBe(4);
 // Now it decides: Alec's word passes, other sounds don't.
 let ok=0,blocked=0;
 for(let i=0;i<10;i++){clock.t+=60000;const d=L.judge(word('harmony',100+i),.95);if(d.accept){ok++;await L.outcome(d.id,'used');}}
 for(let i=0;i<10;i++){clock.t+=60000;const d=L.judge(word('other',200+i),.95);if(!d.accept)blocked++;else await L.outcome(d.id,'unused');}
 expect(ok).toBeGreaterThanOrEqual(9);expect(blocked).toBeGreaterThanOrEqual(7);
 // A miss it notices: rejected, then "Harmony" again within 8 s, and he asks something → the first becomes his.
 const before=L.stats().missesCaught;
 clock.t+=60000;const miss=L.judge(word('other',300),.9);expect(miss.accept).toBe(false);
 clock.t+=3000;const again=L.judge(word('harmony',301),.97);expect(again.accept).toBe(true);await L.outcome(again.id,'used');
 expect(L.stats().missesCaught).toBe(before+1);
 // Sealed on disk; a fresh learner picks up where it left off.
 expect(store.data!.toString()).toMatch(/^sealed:/);
 const L2=new WakeLearner(seal,store,()=>clock.t);await L2.load();expect(L2.stats()).toMatchObject({active:true,positives:L.stats().positives,missesCaught:before+1});
 await L2.reset();expect(store.data).toBeNull();expect(L2.stats().positives).toBe(0);
},60000);
