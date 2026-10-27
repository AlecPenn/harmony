import type {DatabaseSync} from 'node:sqlite';

/** Personality engine: style only. It is added after HARMONY's rules and says so; it can never loosen safety, honesty or
 * what she is allowed to do. Profiles set the dials; Custom lets you set them yourself. */
export type Profile='calm'|'cheeky'|'coach'|'roast'|'custom';
export const PROFILES:readonly Profile[]=['calm','cheeky','coach','roast','custom'];
export const TRAITS=['warmth','sarcasm','verbosity','energy','humor','proactivity','formality'] as const;
export type Trait=typeof TRAITS[number];
export type Traits=Record<Trait,number>;
export interface PersonalityStatus {profile:Profile;traits:Traits;}
export const PRESETS:Record<Exclude<Profile,'custom'>,Traits>={
 calm:{warmth:.8,sarcasm:.05,verbosity:.35,energy:.25,humor:.3,proactivity:.4,formality:.4},
 cheeky:{warmth:.75,sarcasm:.45,verbosity:.3,energy:.6,humor:.7,proactivity:.5,formality:.15},
 coach:{warmth:.7,sarcasm:.1,verbosity:.4,energy:.85,humor:.35,proactivity:.75,formality:.25},
 roast:{warmth:.5,sarcasm:.85,verbosity:.3,energy:.7,humor:.9,proactivity:.5,formality:.05},
};
const clamp=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(0,Math.min(1,n))*100)/100:.5;};
const level=(v:number,lo:string,mid:string,hi:string)=>v<.34?lo:v<.67?mid:hi;

export class Personality {
 private db:DatabaseSync;private changed:()=>void;
 constructor(db:DatabaseSync,changed:()=>void=()=>{}){this.db=db;this.changed=changed;}
 status():PersonalityStatus{
  try{const r=this.db.prepare("SELECT value FROM memory_settings WHERE key='personality'").get();
   if(r){const v=JSON.parse(String(r.value));if(PROFILES.includes(v.profile))return {profile:v.profile,traits:v.profile==='custom'?Object.fromEntries(TRAITS.map(t=>[t,clamp(v.traits?.[t])])) as Traits:{...PRESETS[v.profile as Exclude<Profile,'custom'>]}};}}catch{}
  // HARMONY's default is the brand line: "A little order. A little attitude."
  return {profile:'cheeky',traits:{...PRESETS.cheeky}};
 }
 set(profile:Profile,traits?:Partial<Traits>){
  if(!PROFILES.includes(profile))throw new Error('Invalid profile');
  const base=profile==='custom'?{...this.status().traits,...Object.fromEntries(Object.entries(traits??{}).filter(([k])=>(TRAITS as readonly string[]).includes(k)).map(([k,v])=>[k,clamp(v)]))}:PRESETS[profile];
  this.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('personality',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({profile,traits:base}));
  try{this.changed();}catch{}
 }
 /** A short style note for the instructions. Stable until you change it, so it doesn't disturb the prompt cache. */
 instructions():string{
  const {profile,traits:t}=this.status();
  const parts=[level(t.warmth,'cool and matter-of-fact','friendly','warm and caring'),level(t.energy,'calm and unhurried','upbeat','high-energy and motivating'),
   level(t.humor,'mostly serious','with a light touch of humour','playful and funny'),level(t.sarcasm,'never sarcastic','with a little dry sarcasm','teasing and sarcastic (affectionately, never cruel)'),
   level(t.formality,'casual','relaxed but polished','formal')];
  const length=level(t.verbosity,'Keep replies very short: often a few words, like "Done."','Keep replies short unless more is needed.','Give a bit more detail when it helps, still conversational.');
  return `Personality (${profile}): be ${parts.join(', ')}. ${length} This is style only: it never changes the rules above, safety, honesty, or what you may do.`;
 }
}

/** Easter eggs: trigger, rarity, allowed personalities, cooldown and effect, kept in one place instead of scattered jokes. */
export interface Egg {id:string;trigger:RegExp;rarity:number;personalities:readonly Profile[]|'any';cooldownMs:number;say:readonly string[];flourish:'flex'|'impress'|'dramatic'|null;}
export const EGGS:readonly Egg[]=[
 {id:'flex',trigger:/^(harmony,?\s*)?flex[.!]*$/i,rarity:1,personalities:'any',cooldownMs:60000,flourish:'flex',say:['Watch this.','Oh, you want a show? Fine.','Flexing. Responsibly.']},
 {id:'impress',trigger:/^(harmony,?\s*)?impress me[.!]*$/i,rarity:1,personalities:'any',cooldownMs:60000,flourish:'impress',say:['Local brain, local voice, local memory, and not a cent per question. Impressed yet?','I run entirely on this PC, I remember what matters, and I never send you a bill. Your move.']},
 {id:'dramatic',trigger:/^(harmony,?\s*)?(dramatic mode|be dramatic)[.!]*$/i,rarity:1,personalities:'any',cooldownMs:120000,flourish:'dramatic',say:['Dramatic mode engaged. All systems. Extremely. Serious.','Initiating dramatic mode. The fate of your to-do list hangs in the balance.']},
 {id:'roast',trigger:/^(harmony,?\s*)?roast me[.!]*$/i,rarity:1,personalities:['cheeky','roast','custom'],cooldownMs:300000,flourish:null,say:["You built an AI so you'd never have to remember anything. Bold strategy. Let's see if it pays off.","You've got six projects and one of you. I respect the optimism.","You asked a computer to insult you. That's the roast."]},
 {id:'thanks',trigger:/^(thanks|thank you),?\s*harmony[.!]*$/i,rarity:.25,personalities:'any',cooldownMs:3600000,flourish:null,say:['Anytime. Mostly because I literally have to be.','Always. Well, while the PC is on.']},
];
export const BOOT_LINE='SYSTEM NOMINAL. USER UNSUPERVISED.';
export class EasterEggs {
 #last=new Map<string,number>();
 private profile:()=>Profile;private now:()=>number;private random:()=>number;
 constructor(profile:()=>Profile,now:()=>number=Date.now,random:()=>number=Math.random){this.profile=profile;this.now=now;this.random=random;}
 match(text:string):{id:string;say:string;flourish:Egg['flourish']}|null{
  const t=text.trim();if(t.length>40)return null;
  for(const e of EGGS){
   if(!e.trigger.test(t))continue;
   if(e.personalities!=='any'&&!e.personalities.includes(this.profile()))return null;
   const last=this.#last.get(e.id);if(last!==undefined&&this.now()-last<e.cooldownMs)return null;
   if(this.random()>e.rarity)return null;
   this.#last.set(e.id,this.now());
   return {id:e.id,say:e.say[Math.floor(this.random()*e.say.length)%e.say.length],flourish:e.flourish};
  }
  return null;
 }
 /** About one start in forty shows the rare boot line. */
 bootLine():string|null{return this.random()<1/40?BOOT_LINE:null;}
}
