/** Step 19: a wake word that keeps learning Alec ("learns to learn him").
 *
 * The offline detector (Vosk) still hears "Harmony". This learner then decides whether it was Alec saying it, from the
 * sound of the word itself: 13 MFCCs over the spoken part, compared with his examples by subsequence DTW. It learns
 * from every wake, with no extra effort from him:
 *  - he asks something right after: a good example of him;
 *  - nothing follows, or "never mind" / "that wasn't me": an example of what not to wake on;
 *  - it ignored him and he says "Harmony" again within 8 seconds and goes on to ask something: it missed, so the
 *    missed one becomes a good example too.
 * After each lesson a small logistic model is refitted on all examples, and its threshold is re-chosen so it misses him
 * less than 1 time in 20 while rejecting as many false wakes as the examples allow. Until it has 8 examples of him and
 * 3 of other sounds, it never blocks a wake; it only learns. Examples are stored sealed (Windows encryption). */

export const RATE=16000,FRAME=400,HOP=160,NFFT=512,MELS=26,CEPS=13;
export const MIN_POS=8,MIN_NEG=3,MAX_POS=40,MAX_NEG=40,MISS_TARGET=.05;
type Mat=Float32Array[];

// ---- features ------------------------------------------------------------------------------------------------
function fft(re:Float64Array,im:Float64Array){
 const n=re.length;
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);
  for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const ur=re[i+k],ui=im[i+k],vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci,vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;
   re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}
}
const hz2mel=(f:number)=>2595*Math.log10(1+f/700),mel2hz=(m:number)=>700*(10**(m/2595)-1);
const FILTERS=(()=>{const lo=hz2mel(60),hi=hz2mel(7600),pts=Array.from({length:MELS+2},(_,i)=>Math.floor((NFFT+1)*mel2hz(lo+(hi-lo)*i/(MELS+1))/RATE));
 return Array.from({length:MELS},(_,m)=>{const f=new Float64Array(NFFT/2+1);for(let k=pts[m];k<pts[m+1];k++)f[k]=(k-pts[m])/Math.max(1,pts[m+1]-pts[m]);for(let k=pts[m+1];k<pts[m+2];k++)f[k]=(pts[m+2]-k)/Math.max(1,pts[m+2]-pts[m+1]);return f;});})();
const HAMMING=Float64Array.from({length:FRAME},(_,i)=>.54-.46*Math.cos(2*Math.PI*i/(FRAME-1)));
/** MFCCs of the spoken part only (energy-trimmed), mean-normalised. null if there's no speech in it. */
export function features(pcm:Int16Array):Mat|null{
 const n=Math.floor((pcm.length-FRAME)/HOP)+1;if(n<8)return null;
 const energy=new Float64Array(n),frames:Float64Array[]=[];
 for(let f=0;f<n;f++){
  const re=new Float64Array(NFFT),im=new Float64Array(NFFT);let e=0;
  for(let i=0;i<FRAME;i++){const x=pcm[f*HOP+i]/32768-(i?.97*pcm[f*HOP+i-1]/32768:0);re[i]=x*HAMMING[i];e+=x*x;}
  energy[f]=e;fft(re,im);
  const p=new Float64Array(NFFT/2+1);for(let k=0;k<=NFFT/2;k++)p[k]=(re[k]**2+im[k]**2)/NFFT;
  const mel=FILTERS.map(w=>{let s=1e-10;for(let k=0;k<w.length;k++)s+=w[k]*p[k];return Math.log(s);});
  const c=new Float64Array(CEPS);for(let j=0;j<CEPS;j++){let s=0;for(let m=0;m<MELS;m++)s+=mel[m]*Math.cos(Math.PI*j*(m+.5)/MELS);c[j]=s;}
  frames.push(c);
 }
 // Keep the voiced stretch: frames above 10% of the loudest, with a little margin.
 const peak=Math.max(...energy);if(peak<1e-4)return null;
 let a=0,b=n-1;while(a<n&&energy[a]<peak*.1)a++;while(b>a&&energy[b]<peak*.1)b--;a=Math.max(0,a-3);b=Math.min(n-1,b+3);
 if(b-a<8)return null;
 const out=frames.slice(a,b+1),mean=new Float64Array(CEPS);for(const c of out)for(let j=0;j<CEPS;j++)mean[j]+=c[j]/out.length;
 return out.map(c=>Float32Array.from(c,(v,j)=>j===0?0:v-mean[j])); // c0 (loudness) dropped
}
/** Subsequence DTW: the best match of the template anywhere inside the heard window, per template frame. */
export function sdtw(t:Mat,w:Mat):number{
 const n=t.length,m=w.length,d=(a:Float32Array,b:Float32Array)=>{let s=0;for(let i=1;i<CEPS;i++)s+=(a[i]-b[i])**2;return Math.sqrt(s);};
 let prev=new Float64Array(m).fill(0),cur=new Float64Array(m);
 for(let i=0;i<n;i++){
  for(let j=0;j<m;j++){const c=d(t[i],w[j]);cur[j]=c+(i===0?0:Math.min(prev[j],j?prev[j-1]:Infinity,j?cur[j-1]:Infinity));}
  [prev,cur]=[cur,prev];
 }
 return Math.min(...prev)/n;
}
const nearest=(x:Mat,set:readonly Mat[],skip?:Mat)=>{let best=Infinity;for(const s of set)if(s!==skip)best=Math.min(best,Math.min(sdtw(s,x),sdtw(x,s)));return best;};

// ---- storage format -------------------------------------------------------------------------------------------
/** int8 per coefficient (scale 1/8): a template is about 1 KB. */
export function pack(m:Mat):string{const b=new Int8Array(m.length*CEPS);m.forEach((f,i)=>f.forEach((v,j)=>{b[i*CEPS+j]=Math.max(-127,Math.min(127,Math.round(v*8)));}));return Buffer.from(b.buffer).toString('base64');}
export function unpack(s:string):Mat{const b=new Int8Array(Buffer.from(s,'base64'));const out:Mat=[];for(let i=0;i+CEPS<=b.length;i+=CEPS)out.push(Float32Array.from(b.subarray(i,i+CEPS),v=>v/8));return out;}

// ---- the learner -----------------------------------------------------------------------------------------------
export interface Sealer {available():Promise<boolean>;encrypt(text:string):Promise<Buffer>;decrypt(data:Buffer):Promise<string>;}
export interface Store {read():Promise<Buffer|null>;write(data:Buffer):Promise<void>;clear():Promise<void>;}
interface Example {m:Mat;conf:number;at:string;source:'taught'|'used'|'recovered'|'unused'|'denied';}
export interface WakeStats {positives:number;negatives:number;active:boolean;threshold:number|null;accepted:number;rejected:number;missesCaught:number;falseWakes:number;recentMissRate:number|null;recentFalseRate:number|null;}
export interface Decision {id:number;accept:boolean;score:number|null;reason:string;}
interface Pending {id:number;m:Mat;conf:number;at:number;accepted:boolean;}

export class WakeLearner {
 #pos:Example[]=[];#neg:Example[]=[];#w=[0,0,0,0];#t:number|null=null;#loaded=false;#next=1;
 #pending:Pending[]=[];#history:('ok'|'miss'|'false')[]=[];
 #counts={accepted:0,rejected:0,missesCaught:0,falseWakes:0};
 private seal:Sealer;private store:Store;private now:()=>number;
 constructor(seal:Sealer,store:Store,now:()=>number=Date.now){this.seal=seal;this.store=store;this.now=now;}
 async load(){
  if(this.#loaded)return;this.#loaded=true;
  try{const raw=await this.store.read();if(!raw||!await this.seal.available())return;
   const v=JSON.parse(await this.seal.decrypt(raw)) as {pos:{m:string;conf:number;at:string;source:Example['source']}[];neg:typeof v.pos;counts:Partial<Record<'accepted'|'rejected'|'missesCaught'|'falseWakes',number>>;history:('ok'|'miss'|'false')[]};
   this.#pos=(v.pos??[]).slice(-MAX_POS).map(e=>({...e,m:unpack(e.m)}));this.#neg=(v.neg??[]).slice(-MAX_NEG).map(e=>({...e,m:unpack(e.m)}));
   this.#counts={...this.#counts,...v.counts};this.#history=(v.history??[]).slice(-50);this.#fit();
  }catch{}
 }
 async #save(){
  if(!await this.seal.available())return;
  const enc=(e:Example)=>({m:pack(e.m),conf:e.conf,at:e.at,source:e.source});
  await this.store.write(await this.seal.encrypt(JSON.stringify({v:1,pos:this.#pos.map(enc),neg:this.#neg.map(enc),counts:this.#counts,history:this.#history})));
 }
 #x(m:Mat,conf:number,skip?:Mat){const p=nearest(m,this.#pos.map(e=>e.m),skip),q=this.#neg.length?nearest(m,this.#neg.map(e=>e.m),skip):p+2;return [1,(conf-.9)*10,p,q-p];}
 #score(x:number[]){let s=0;for(let i=0;i<4;i++)s+=this.#w[i]*x[i];return s;}
 get active(){return this.#pos.length>=MIN_POS&&this.#neg.length>=MIN_NEG&&this.#t!==null;}
 /** Refit on every example (leave-one-out distances), then pick the threshold that keeps misses under 5%. */
 #fit(){
  if(this.#pos.length<2){this.#t=null;return;}
  const data=[...this.#pos.map(e=>({x:this.#x(e.m,e.conf,e.m),y:1})),...this.#neg.map(e=>({x:this.#x(e.m,e.conf,e.m),y:0}))];
  let w=[0,0,-1,1];const lr=.1,l2=.01;
  for(let it=0;it<400;it++){const g=[0,0,0,0];for(const d of data){const p=1/(1+Math.exp(-this.#dot(w,d.x)));for(let i=0;i<4;i++)g[i]+=(p-d.y)*d.x[i];}
   w=w.map((v,i)=>v-lr*(g[i]/data.length+(i?l2*v:0)));}
  this.#w=w;
  const ps=data.filter(d=>d.y).map(d=>this.#dot(w,d.x)).sort((a,b)=>a-b),ns=data.filter(d=>!d.y).map(d=>this.#dot(w,d.x));
  // The 5th-percentile positive score, lowered a touch by recent misses (it learns how strict to be).
  const misses=this.#history.filter(h=>h==='miss').length/Math.max(10,this.#history.length);
  const k=Math.floor(ps.length*MISS_TARGET);this.#t=(ps[k]??ps[0])-.25-2*misses;
  if(ns.length&&Math.max(...ns)<this.#t-.5)this.#t=Math.max(...ns)+(this.#t-Math.max(...ns))/2; // don't be stricter than needed
 }
 #dot(w:number[],x:number[]){let s=0;for(let i=0;i<4;i++)s+=w[i]*x[i];return s;}
 /** A wake from the detector, with the last ~1.6 s of audio. Accepts unless it has learned enough to say no. */
 judge(pcm:Int16Array,conf:number):Decision{
  const m=features(pcm),id=this.#next++,at=this.now();
  this.#pending=this.#pending.filter(p=>at-p.at<20000).slice(-6);
  if(!m){this.#counts.accepted++;return {id,accept:true,score:null,reason:'no clear audio; allowed'};}
  if(!this.active){this.#pending.push({id,m,conf,at,accepted:true});this.#counts.accepted++;return {id,accept:true,score:null,reason:`still learning (${this.#pos.length} of ${MIN_POS} examples of you)`};}
  const s=this.#score(this.#x(m,conf)),accept=s>=this.#t!;
  this.#pending.push({id,m,conf,at,accepted:accept});
  if(accept)this.#counts.accepted++;else this.#counts.rejected++;
  return {id,accept,score:Math.round(s*100)/100,reason:accept?'sounds like you':'didn\'t sound like you saying it'};
 }
 /** What happened after an accepted wake: "used" (you asked something), "unused" (nothing came), "denied" ("never mind"). */
 async outcome(id:number,what:'used'|'unused'|'denied'){
  const p=this.#pending.find(x=>x.id===id);if(!p)return;this.#pending=this.#pending.filter(x=>x.id!==id);
  const at=new Date(this.now()).toISOString();
  if(what==='used'){
   this.#add(this.#pos,{m:p.m,conf:p.conf,at,source:'used'},MAX_POS);this.#history.push('ok');
   // A wake it rejected just before this one was a miss: learn it as you, and count the mistake.
   for(const r of this.#pending.filter(x=>!x.accepted&&p.at-x.at<=8000&&x.at<p.at)){this.#add(this.#pos,{m:r.m,conf:r.conf,at,source:'recovered'},MAX_POS);this.#counts.missesCaught++;this.#history.push('miss');this.#pending=this.#pending.filter(x=>x!==r);}
  }else{this.#add(this.#neg,{m:p.m,conf:p.conf,at,source:what},MAX_NEG);this.#counts.falseWakes++;this.#history.push('false');}
  this.#history=this.#history.slice(-50);this.#fit();await this.#save().catch(()=>{});
 }
 /** Newest kept; when full, the oldest learned example goes first (taught ones stay longest). */
 #add(list:Example[],e:Example,max:number){list.push(e);if(list.length>max){const i=list.findIndex(x=>x.source!=='taught');list.splice(i>=0?i:0,1);}}
 /** Teaching: one clip of Alec saying "Harmony". Returns how many he has taught so far. */
 async teach(pcm:Int16Array):Promise<{ok:boolean;count:number;reason:string|null}>{
  const m=features(pcm);if(!m)return {ok:false,count:this.#pos.filter(e=>e.source==='taught').length,reason:'I couldn\'t hear the word clearly. Try again a little closer to the mic.'};
  this.#add(this.#pos,{m,conf:1,at:new Date(this.now()).toISOString(),source:'taught'},MAX_POS);this.#fit();await this.#save().catch(()=>{});
  return {ok:true,count:this.#pos.filter(e=>e.source==='taught').length,reason:null};
 }
 /** Background sounds he records (TV, music, talking): taught as "not a wake". */
 async teachNot(pcm:Int16Array){const m=features(pcm);if(!m)return false;this.#add(this.#neg,{m,conf:.9,at:new Date(this.now()).toISOString(),source:'denied'},MAX_NEG);this.#fit();await this.#save().catch(()=>{});return true;}
 async reset(){this.#pos=[];this.#neg=[];this.#w=[0,0,0,0];this.#t=null;this.#history=[];this.#counts={accepted:0,rejected:0,missesCaught:0,falseWakes:0};await this.store.clear().catch(()=>{});}
 stats():WakeStats{
  const h=this.#history,n=h.length;
  return {positives:this.#pos.length,negatives:this.#neg.length,active:this.active,threshold:this.#t===null?null:Math.round(this.#t*100)/100,...this.#counts,
   recentMissRate:n>=10?Math.round(h.filter(x=>x==='miss').length/n*100)/100:null,recentFalseRate:n>=10?Math.round(h.filter(x=>x==='false').length/n*100)/100:null};
 }
}
export const DENY=/^(never ?mind|nothing|not you|nope|no|go away|i wasn'?t talking to you|that wasn'?t (me|for you)|wrong|false alarm|cancel)$/;
