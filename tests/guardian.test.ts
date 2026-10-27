import {describe,expect,it,vi} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {Guardian,GuardDenied,rotation,cosine,vector,describeAction,type Seal,type GuardDeps} from '../core/guardian.ts';

const seal:Seal={available:async()=>true,encrypt:async t=>Buffer.from('sealed:'+t),decrypt:async b=>b.toString().replace(/^sealed:/,'')};
function unit(dim:number,seed:number,noise=0,base?:Float32Array){
 let x=seed;const r=()=>{x=(x*1103515245+12345)%2147483648;return x/2147483648-.5;};
 const v=new Float32Array(dim);for(let i=0;i<dim;i++)v[i]=(base?base[i]:r())+noise*r();
 let n=0;for(const a of v)n+=a*a;n=Math.sqrt(n);return v.map(a=>a/n);
}
function setup(opts:{phone?:boolean;now?:{t:number}}={}){
 const db=openDatabase(':memory:'),clock=opts.now??{t:1_000_000},alerts:string[]=[];
 const deps:GuardDeps={phonePaired:()=>opts.phone??true,alert:t=>{alerts.push(t);},changed:()=>{},models:()=>({voice:true,face:true})};
 const g=new Guardian(db,seal,deps,()=>clock.t);
 return {g,db,clock,alerts};
}
const ME=unit(256,7),STRANGER=unit(256,99),MYFACE=unit(128,3),OTHERFACE=unit(128,55);
async function enrolled(opts={}){
 const s=setup(opts);await s.g.load();
 for(let i=0;i<3;i++)s.g.enrollVoice(unit(256,7,.25,ME).map(x=>x) as Float32Array);
 return s;
}

describe('cancelable prints',()=>{
 it('a secret rotation keeps similarity but changes the numbers',()=>{
  const q=rotation(Buffer.alloc(32,1),16),a=unit(16,1),b=unit(16,2);
  const rot=(v:Float32Array)=>Float32Array.from(q.map(row=>row.reduce((s,x,i)=>s+x*v[i],0)));
  expect(cosine(rot(a),rot(b))).toBeCloseTo(cosine(a,b),5);
  expect(Math.abs(rot(a)[0]-a[0])).toBeGreaterThan(1e-3);
  const q2=rotation(Buffer.alloc(32,2),16);expect(q2[0][0]).not.toBeCloseTo(q[0][0],6);
 });
 it('the vault is sealed; no plain prints are stored',async()=>{
  const {g,db}=await enrolled();await new Promise(r=>setTimeout(r,5));
  const row=db.prepare("SELECT value FROM memory_settings WHERE key='guard_vault'").get();
  const opened=JSON.parse(Buffer.from(String(row!.value),'base64').toString().replace(/^sealed:/,''));
  expect(opened.voice).toHaveLength(3);
  // Stored prints are rotated: none equals the original voice.
  for(const p of opened.voice)expect(cosine(vector(p,256)!,ME)).toBeLessThan(.5);
  expect(g.status().voice.enrolled).toBe(3);
 });
 it('without Windows encryption nothing is enrolled',async()=>{
  const db=openDatabase(':memory:');const g=new Guardian(db,{...seal,available:async()=>false},{phonePaired:()=>false,alert(){},changed(){},models:()=>({voice:true,face:true})});
  await g.load();expect(()=>g.enrollVoice(ME)).toThrow(GuardDenied);
 });
 it('reset makes old prints useless (new key)',async()=>{
  const {g}=await enrolled();await g.reset('all');expect(g.status().voice.enrolled).toBe(0);
 });
});

describe('voice',()=>{
 it('recognises the owner and not a stranger',async()=>{
  const {g}=await enrolled();
  expect(g.judgeVoice(unit(256,7,.25,ME)).who).toBe('owner');
  expect(g.judgeVoice(STRANGER).who).toBe('stranger');
 });
 it('waits for a print that arrives slightly after the words',async()=>{
  const {g}=await enrolled();
  const p=g.verdict(5,500);setTimeout(()=>g.voice(5,unit(256,7,.25,ME)),10);
  expect((await p).who).toBe('owner');
  expect((await g.verdict(9,20)).who).toBe('unsure'); // never arrived: can't tell
 });
 it('unchecked until three clips are enrolled',async()=>{
  const {g}=setup();await g.load();expect((await g.verdict(1)).who).toBe('unchecked');
 });
 it('three strangers in two minutes lock and alert',async()=>{
  const {g,alerts}=await enrolled();
  for(let i=0;i<3;i++)g.judgeVoice(unit(256,200+i));
  expect(g.locked?.strict).toBe(false);expect(alerts.join(' ')).toMatch(/voices/);
 });
});

describe('face',()=>{
 it('live owner unlocks an away-lock; a photo of the owner locks strictly',async()=>{
  const {g,alerts}=await enrolled();
  expect(g.enrollFace({faces:1,embedding:MYFACE,live:3,yaw:0}).problem).toBeNull();
  expect(g.enrollFace({faces:2,embedding:MYFACE,live:3,yaw:0}).problem).toMatch(/Only you/);
  expect(g.enrollFace({faces:1,embedding:MYFACE,live:-3,yaw:0}).problem).toMatch(/live/);
  g.lock('You were away',false);
  expect(g.seen({faces:1,embedding:unit(128,3,.2,MYFACE),live:2,yaw:0}).who).toBe('owner');
  expect(g.locked).toBeNull();
  g.seen({faces:1,embedding:MYFACE,live:-4,yaw:0});
  expect(g.locked?.strict).toBe(true);expect(alerts.join(' ')).toMatch(/photo/);
 });
 it('counts onlookers for the privacy veil',async()=>{
  const {g}=await enrolled();g.enrollFace({faces:1,embedding:MYFACE,live:3,yaw:0});
  g.seen({faces:2,embedding:MYFACE,live:3,yaw:0});
  expect(g.status().onlookers).toBe(1);expect(g.status().veil).toBe(true);
  g.seen({faces:1,embedding:OTHERFACE,live:3,yaw:0});expect(g.status().onlookers).toBe(1);
 });
});

describe('authorize',()=>{
 const sig=()=>new AbortController().signal;
 it('public lookups always run, even for strangers and when locked',async()=>{
  const {g}=await enrolled();g.begin('voice',{who:'stranger',score:.1});g.lock('x',true);
  await expect(g.authorize('web.weather','SAFE',{},sig())).resolves.toBeUndefined();
 });
 it('strangers get nothing personal; unsure is asked to repeat',async()=>{
  const {g}=await enrolled();
  g.begin('voice',{who:'stranger',score:.1});await expect(g.authorize('memory.recall','SAFE',{},sig())).rejects.toThrow(/only do that/);
  g.begin('voice',{who:'unsure',score:.4});await expect(g.authorize('gmail.search','SAFE',{},sig())).rejects.toThrow(/sure/);
  g.begin('voice',{who:'owner',score:.8});await expect(g.authorize('gmail.search','SAFE',{},sig())).resolves.toBeUndefined();
 });
 it('desktop control waits for the phone, with number matching',async()=>{
  const {g}=await enrolled();g.begin('voice',{who:'owner',score:.8});
  const said:string[]=[];
  const p=g.authorize('computer.open_app','LOW_RISK_WRITE',{name:'Spotify',appId:'x'},sig(),t=>said.push(t));
  const [a]=g.pending('phone');expect(a.title).toBe('Open Spotify');expect(a.choices).toHaveLength(3);
  const code=g.status().approvals[0].code;expect(a.choices).toContain(code);expect(said[0]).toContain(String(code));
  expect(g.answer(a.id,{approve:true,pick:code,trust:false},'desk')).toBe('gone'); // phone paired: screen can't approve
  expect(g.answer(a.id,{approve:true,pick:code,trust:false},'phone')).toBe('ok');
  await expect(p).resolves.toBeUndefined();
  expect(g.answer(a.id,{approve:true,pick:code,trust:false},'phone')).toBe('gone'); // single use
 });
 it('the wrong number is a refusal; three refusals pause approvals',async()=>{
  const {g,alerts}=await enrolled();g.begin('typed');
  for(let i=0;i<3;i++){
   const p=g.authorize('computer.media','LOW_RISK_WRITE',{key:'mute',times:'1'},sig());
   const [a]=g.pending('phone');const code=g.status().approvals[0].code;
   expect(g.answer(a.id,{approve:true,pick:a.choices.find(c=>c!==code)!,trust:false},'phone')).toBe('wrong');
   await expect(p).rejects.toThrow(GuardDenied);
  }
  expect(g.status().paused).not.toBeNull();expect(alerts.join(' ')).toMatch(/paused/);
  await expect(g.authorize('computer.media','LOW_RISK_WRITE',{key:'mute',times:'1'},sig())).rejects.toThrow(/paused/);
 });
 it('"approve for 10 minutes" trusts that kind of action for a while',async()=>{
  const {g,clock}=await enrolled();g.begin('typed');
  const p=g.authorize('computer.focus','LOW_RISK_WRITE',{hwnd:'1'},sig());const [a]=g.pending('phone');
  g.answer(a.id,{approve:true,pick:g.status().approvals[0].code,trust:true},'phone');await p;
  await expect(g.authorize('computer.open_app','LOW_RISK_WRITE',{name:'x'},sig())).resolves.toBeUndefined();
  clock.t+=11*60000;
  const q=g.authorize('computer.open_app','LOW_RISK_WRITE',{name:'x'},sig());expect(g.pending('phone')).toHaveLength(1);
  const b=g.pending('phone')[0];g.answer(b.id,{approve:false,pick:null,trust:false},'phone');await expect(q).rejects.toThrow(/Not approved/);
 });
 it('without a phone, the screen approves; a stop cancels the wait',async()=>{
  const {g}=await enrolled({phone:false});g.begin('typed');
  const c=new AbortController();const p=g.authorize('computer.open_url','LOW_RISK_WRITE',{url:'https://example.com/x'},c.signal);
  expect(g.pending('desk')[0].title).toBe('Open example.com');c.abort();await expect(p).rejects.toThrow();
  expect(g.status().paused).toBeNull();
 });
 it('"unless she can see it\'s me" skips the phone right after a live face match',async()=>{
  const {g}=await enrolled();g.update({phone:'unless-seen'});g.enrollFace({faces:1,embedding:MYFACE,live:3,yaw:0});
  g.begin('voice',{who:'owner',score:.8});g.judgeVoice(unit(256,7,.25,ME));
  await expect(g.authorize('computer.media','LOW_RISK_WRITE',{key:'mute'},sig())).resolves.toBeUndefined();
 });
 it('clicks in HARMONY itself never need the phone',async()=>{
  const {g}=await enrolled();g.begin('screen');
  await expect(g.authorize('memory.remember','LOW_RISK_WRITE',{text:'x'},sig())).resolves.toBeUndefined();
 });
});

describe('locks and phrases',()=>{
 it('the duress phrase locks silently and alerts the phone',async()=>{
  const {g,alerts}=await enrolled();g.setDuress('purple monkey dishwasher');
  expect(g.intercept('Harmony, purple monkey dishwasher!',{who:'owner',score:.9})).toBe('Okay.');
  expect(g.locked?.strict).toBe(true);expect(alerts.join(' ')).toMatch(/duress/);
  expect(()=>g.setDuress('hi')).toThrow(/two to ten/);
 });
 it('"lock down" locks; "unlock" sends a request to the phone',async()=>{
  const {g}=await enrolled();
  expect(g.intercept('lock down',{who:'owner',score:.9})).toMatch(/Locked down/);
  expect(g.intercept('unlock',{who:'owner',score:.9})).toMatch(/phone/);
  const [a]=g.pending('phone');expect(a.title).toBe('Unlock HARMONY');
  g.answer(a.id,{approve:true,pick:g.status().approvals[0].code,trust:true},'phone');
  await new Promise(r=>setTimeout(r,1));expect(g.locked).toBeNull();
 });
 it('locks after being away, not while you are seen; Windows locking locks too',async()=>{
  const {g,clock}=await enrolled();g.update({lockAfterMin:5});
  g.tick(4*60);expect(g.locked).toBeNull();
  clock.t+=6*60000;g.tick(6*60);expect(g.locked?.reason).toMatch(/away/);
  g.unlock('test');g.windowsLocked();expect(g.locked?.reason).toMatch(/Windows/);
 });
 it('the lock survives a restart',async()=>{
  const s=await enrolled();s.g.lock('You asked',true);
  const again=new Guardian(s.db,seal,{phonePaired:()=>true,alert(){},changed(){},models:()=>({voice:true,face:true})});await again.load();
  expect(again.locked?.strict).toBe(true);
 });
 it('phone-typed requests are told apart from the keyboard',async()=>{
  const {g}=await enrolled();g.markPhoneAsk();g.begin('typed');
  const p=g.authorize('computer.media','LOW_RISK_WRITE',{key:'mute'},new AbortController().signal);
  expect(g.pending('phone')).toHaveLength(1);g.answer(g.pending('phone')[0].id,{approve:false,pick:null,trust:false},'phone');await expect(p).rejects.toThrow();
 });
});

describe('describeAction',()=>{
 it('shows names and hosts only',()=>{
  expect(describeAction('computer.open_url',{url:'https://mail.google.com/x?secret=1'}).title).toBe('Open mail.google.com');
  expect(describeAction('computer.media',{key:'volume_up'}).title).toBe('Press volume up');
 });
});

describe('changing security itself',()=>{
 it('is refused while locked, and needs the phone when one is paired',async()=>{
  const {g}=await enrolled();g.lock('x',false);await expect(g.sensitive('Change security settings')).rejects.toThrow(/Unlock/);g.unlock('t');
  const p=g.sensitive('Change security settings');const [a]=g.pending('phone');expect(a.title).toBe('Change security settings');
  g.answer(a.id,{approve:true,pick:g.status().approvals[0].code,trust:false},'phone');await p;
  await expect(g.sensitive('Teach HARMONY a voice')).resolves.toBeUndefined(); // trusted for 10 minutes after approval
 });
 it('without a phone it simply proceeds (first-time setup)',async()=>{
  const {g}=await enrolled({phone:false});await expect(g.sensitive('x')).resolves.toBeUndefined();
 });
});

describe('spoken challenge words',()=>{
 const sig=()=>new AbortController().signal;
 async function noPhone(mic=true){
  const db=openDatabase(':memory:'),clock={t:1_000_000},listens:boolean[]=[];
  const g=new Guardian(db,seal,{phonePaired:()=>false,alert:()=>{},changed:()=>{},models:()=>({voice:true,face:true}),listen:on=>{listens.push(on);return mic;}},()=>clock.t);
  await g.load();for(let i=0;i<3;i++)g.enrollVoice(unit(256,7,.25,ME));
  return {g,listens};
 }
 it('matches the words in order, tolerating small mishearings and fillers',async()=>{
  const {saidWords,challengeWords,CHALLENGE_WORDS}=await import('../core/guardian.ts');
  expect(saidWords('Harbour, maple, tiger.',['harbor','maple','tiger'])).toBe(true);
  expect(saidWords('okay harmony um harbor maple tiger',['harbor','maple','tiger'])).toBe(true);
  expect(saidWords('maple harbor tiger',['harbor','maple','tiger'])).toBe(false); // wrong order
  expect(saidWords('harbor maple',['harbor','maple','tiger'])).toBe(false);
  expect(saidWords('I was walking by the harbor under a maple and saw a tiger yesterday',['harbor','maple','tiger'])).toBe(false);
  expect(saidWords('tigers',['harbor','maple','tiger'])).toBe(false);
  const w=challengeWords();expect(new Set(w).size).toBe(3);for(const x of w)expect(CHALLENGE_WORDS).toContain(x);
  expect(new Set(CHALLENGE_WORDS).size).toBe(CHALLENGE_WORDS.length);
 });
 it('your voice saying the words approves; the mic opens and closes',async()=>{
  const {g,listens}=await noPhone();g.begin('voice',{who:'owner',score:.8});const said:string[]=[];
  const p=g.authorize('computer.open_app','LOW_RISK_WRITE',{name:'Spotify',appId:'x'},sig(),t=>said.push(t));
  const words=g.status().approvals[0].words!;expect(words).toHaveLength(3);expect(said[0]).toContain(words.join(', '));
  g.voice(41,STRANGER);expect(await g.spoken(words.join(' '),41)).toBe('ignored'); // someone else (or HARMONY's own echo)
  expect(g.status().approvals).toHaveLength(1);expect(g.status().events[0].kind).toBe('challenge');
  g.voice(42,unit(256,7,.25,ME));expect(await g.spoken('the wrong words entirely',42)).toBe('ignored');
  g.voice(43,unit(256,7,.25,ME));expect(await g.spoken(words.join(' '),43)).toBe('approved');
  await expect(p).resolves.toBeUndefined();expect(listens).toEqual([true,false]);
 });
 it('"no" in your voice refuses; a stranger saying no is ignored',async()=>{
  const {g}=await noPhone();g.begin('voice',{who:'owner',score:.8});
  const p=g.authorize('computer.media','LOW_RISK_WRITE',{key:'mute',times:'1'},sig());
  g.voice(1,STRANGER);expect(await g.spoken('no',1)).toBe('ignored');
  g.voice(2,unit(256,7,.25,ME));expect(await g.spoken('No, cancel that.',2)).toBe('refused');
  await expect(p).rejects.toThrow(GuardDenied);
 });
 it('no words without a live mic, with a phone paired, or for unlocking',async()=>{
  const off=await noPhone(false);off.g.begin('typed');
  void off.g.authorize('computer.media','LOW_RISK_WRITE',{key:'mute',times:'1'},sig()).catch(()=>{});
  expect(off.g.status().approvals[0].words).toBeUndefined();
  const {g}=await enrolled();g.begin('typed');
  void g.authorize('computer.media','LOW_RISK_WRITE',{key:'mute',times:'1'},sig()).catch(()=>{});
  expect(g.status().approvals[0].words).toBeUndefined();
  const u=await noPhone();u.g.lock('x',false);void u.g.requestUnlock().catch(()=>{});
  expect(u.g.status().approvals[0].words).toBeUndefined();
 });
});
