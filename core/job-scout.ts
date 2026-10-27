import type {DatabaseSync} from 'node:sqlite';

/** Step 24: the remote job scout, a Spiral Time job. About once a week (or the next Spiral Time after the owner says
 * "find me remote jobs"), Claude searches for well-paid remote roles that fit the owner's profile, ranks them, and drafts a
 * tailored cover letter for the best one. HARMONY keeps the leads on this PC, never repeats one she has already shown,
 * and never applies for anything: the owner opens the link and sends the letter themselves.
 *
 * The profile is the only personal text that leaves the PC (inside the Spiral Time ticket). It's what a résumé would
 * say: work history, skills, the roles wanted and the pay floor. Nothing else about the owner goes in it. */

export interface JobProfile {name:string;wants:string;experience:string;skills:string;minPay:string;avoid:string;enabled:boolean;}
export interface JobLead {title:string;company:string;url:string;pay:string;posted:string;fit:number;why:string;status:'new'|'saved'|'applied'|'hidden';}
export interface CoverLetter {url:string;text:string;}
export interface ScoutRun {at:string;leads:JobLead[];letter:CoverLetter|null;heard:boolean;}
export interface JobsView {profile:JobProfile;latest:ScoutRun|null;wanted:boolean;due:boolean;lastScout:string|null;}

/** Empty until the owner fills it in (Settings → Jobs, or data/profile.json): the scout stays off without a profile. */
export const DEFAULT_PROFILE:JobProfile={
 name:'',wants:'',experience:'',skills:'',minPay:'',
 avoid:'Commission-only, unpaid trials, "pay to apply", crypto schemes, MLM, roles that aren\'t really remote.',
 enabled:false,
};
const KEY='job_profile',RUNS='job_scout_runs',SEEN='job_scout_seen',WANT='job_scout_want',LAST='job_scout_last';
const SCOUT_DAYS=7,MAX_LEADS=12,MAX_SEEN=300;
const clean=(v:unknown,n:number)=>String(v??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g,' ').replace(/<\/?(?:tool_call|function|parameter)[^>]*>/gi,'').trim().slice(0,n);
const field=(v:unknown,n:number)=>clean(v,n).replace(/\s+/g,' ');
/** A job link, normalised so the same posting isn't shown twice (tracking parameters and fragments dropped). */
export function jobUrl(u:unknown):string|null{
 try{const url=new URL(String(u??''));if(url.protocol!=='https:'&&url.protocol!=='http:')return null;url.hash='';
  for(const k of [...url.searchParams.keys()])if(/^(utm_|ref$|refid|source$|src$|gh_src|lever-source|trk|fbclid|gclid)/i.test(k))url.searchParams.delete(k);
  return url.href.replace(/\/$/,'').slice(0,500);}catch{return null;}
}
/** Validates the leads and letter that come back with a job-scout result. Untrusted text: only kept as data. */
export function parseLeads(v:unknown,seen:ReadonlySet<string>=new Set()):{leads:JobLead[];letter:CoverLetter|null}{
 const o=(v&&typeof v==='object'?v:{}) as {leads?:unknown;letter?:unknown};
 const out:JobLead[]=[],urls=new Set<string>();
 for(const raw of Array.isArray(o.leads)?o.leads.slice(0,30):[]){
  const r=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>,url=jobUrl(r.url);
  const title=field(r.title,120),company=field(r.company,80);
  if(!url||!title||urls.has(url)||seen.has(url))continue;
  const fit=Math.round(Math.max(0,Math.min(100,Number(r.fit)||0)));
  urls.add(url);out.push({title,company:company||new URL(url).hostname.replace(/^www\./,''),url,pay:field(r.pay,60),posted:field(r.posted,30),fit,why:field(r.why,300),status:'new'});
 }
 out.sort((a,b)=>b.fit-a.fit);
 const leads=out.slice(0,MAX_LEADS);
 const l=(o.letter&&typeof o.letter==='object'?o.letter:null) as {url?:unknown;text?:unknown}|null;
 const lu=jobUrl(l?.url),text=clean(l?.text,4000);
 const letter=lu&&text.length>=200&&leads.some(x=>x.url===lu)?{url:lu,text}:null;
 return {leads,letter};
}

export class JobScout {
 private db:DatabaseSync;private now:()=>Date;private defaults:JobProfile;
 /** defaults: the owner's profile from data/profile.json (private, not in git), used until edited in Settings. */
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date(),defaults:Partial<JobProfile>={}){this.db=db;this.now=now;this.defaults={...DEFAULT_PROFILE,...defaults};}
 #get(key:string){try{return (this.db.prepare('SELECT value FROM memory_settings WHERE key=?').get(key) as {value?:string}|undefined)?.value??null;}catch{return null;}}
 #set(key:string,value:string){this.db.prepare('INSERT INTO memory_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 #json<T>(key:string,fallback:T):T{try{const v=JSON.parse(this.#get(key)??'null');return v??fallback;}catch{return fallback;}}

 profile():JobProfile{const p=this.#json<Partial<JobProfile>>(KEY,{});return {...this.defaults,...Object.fromEntries(Object.entries(p).filter(([k])=>k in DEFAULT_PROFILE))} as JobProfile;}
 setProfile(p:Partial<JobProfile>|Record<string,unknown>):JobProfile{
  const cur=this.profile(),next={...cur};
  for(const k of ['name','wants','experience','skills','minPay','avoid'] as const)if(typeof p[k]==='string')next[k]=field(p[k],k==='name'?80:k==='minPay'?60:900);
  if(typeof p.enabled==='boolean')next.enabled=p.enabled;
  this.#set(KEY,JSON.stringify(next));return next;
 }
 seen():Set<string>{return new Set(this.#json<string[]>(SEEN,[]));}
 /** "Find me remote jobs": scout on the next Spiral Time, even if the week isn't up. */
 want(on=true){this.#set(WANT,on?'1':'0');}
 wanted(){return this.#get(WANT)==='1';}
 /** Whether tonight's Spiral Time should include a scout. */
 due():boolean{
  const p=this.profile();if(!p.enabled)return false;if(this.wanted())return true;
  const last=Date.parse(this.#get(LAST)??'');return !Number.isFinite(last)||this.now().getTime()-last>=SCOUT_DAYS*86400000;
 }
 /** The job's text in the ticket: the profile, what to skip, and the extra fields to return. */
 jobText():string{
  const p=this.profile(),skip=[...this.seen()].slice(-60);
  return `Remote job scout for ${p.name}. Find currently open, fully remote roles (US-friendly; he's in the Central time zone) posted in the last 14 days that pay at least ${p.minPay}, and rank the best 8 to 12 by fit.
Wants: ${p.wants}
Experience: ${p.experience}
Skills: ${p.skills}
Skip: ${p.avoid} Skip postings with no stated pay unless the company is well known for paying well. Use the company's own careers page or a reputable job board, and only link to a live posting.
For the best fit, write a tailored cover letter (250 to 350 words, plain text, honest: only claim the experience above; connect the operations and crew-leading background to the role; sign it ${p.name}).
In the result JSON, besides "summary", "report" (the ranked list in plain words) and "sources", add:
"leads":[{"title":"…","company":"…","url":"https://…","pay":"$…","posted":"YYYY-MM-DD","fit":0-100,"why":"one line"}] and "letter":{"url":"<the best lead's url>","text":"…"}.${skip.length?`\nAlready shown to him, don't repeat: ${skip.join(' ')}`:''}`;
 }
 /** Imports a finished scout. Returns the run, or null if it had nothing usable. */
 record(extra:unknown):ScoutRun|null{
  const seen=this.seen(),{leads,letter}=parseLeads(extra,seen);
  this.#set(LAST,this.now().toISOString());this.want(false);
  if(!leads.length)return null;
  const run:ScoutRun={at:this.now().toISOString(),leads,letter,heard:false};
  this.#set(RUNS,JSON.stringify([...this.runs(),run].slice(-8)));
  this.#set(SEEN,JSON.stringify([...seen,...leads.map(l=>l.url)].slice(-MAX_SEEN)));
  return run;
 }
 runs():ScoutRun[]{const v=this.#json<ScoutRun[]>(RUNS,[]);return Array.isArray(v)?v:[];}
 latest():ScoutRun|null{return this.runs().at(-1)??null;}
 /** Saved, applied or hidden, from the panel. */
 mark(url:string,status:JobLead['status']):boolean{
  const runs=this.runs();let hit=false;
  for(const r of runs)for(const l of r.leads)if(l.url===url){l.status=status;hit=true;}
  if(hit)this.#set(RUNS,JSON.stringify(runs));return hit;
 }
 /** Spoken: the top few from the latest scout (titles, companies and pay; links are in the panel). */
 spoken():string{
  const r=this.latest();
  if(!r)return this.wanted()?"No job scout yet. It's set for the next Spiral Time.":'No job scout yet. Say "find me remote jobs" and I\'ll scout on the next Spiral Time.';
  const open=r.leads.filter(l=>l.status!=='hidden');
  if(!open.length)return 'You\'ve gone through every lead from the last scout. Say "find me remote jobs" for a fresh one.';
  const top=open.slice(0,3).map(l=>`${l.title} at ${l.company}${l.pay?`, ${l.pay}`:''}`).join('; ');
  const when=new Date(r.at).toLocaleDateString('en-US',{weekday:'long'});
  const letter=r.letter?` I drafted a cover letter for ${(open.find(l=>l.url===r.letter!.url)??r.leads.find(l=>l.url===r.letter!.url))?.title??'the best one'}; it's in the Jobs panel.`:'';
  return `The scout on ${when} found ${open.length} remote role${open.length>1?'s':''}. Best: ${top}.${letter}`;
 }
 view():JobsView{return {profile:this.profile(),latest:this.latest(),wanted:this.wanted(),due:this.due(),lastScout:this.#get(LAST)};}
 /** Only links HARMONY was given as leads can be opened from the panel. */
 isLead(url:string){return this.runs().some(r=>r.leads.some(l=>l.url===url));}
 markHeard(){const runs=this.runs();const r=runs.at(-1);if(r&&!r.heard){r.heard=true;this.#set(RUNS,JSON.stringify(runs));}}
 /** For the morning brief, once per run. */
 morningLine():string|null{
  const r=this.latest();if(!r||r.heard)return null;this.markHeard();
  const best=r.leads[0];
  return `The job scout found ${r.leads.length} remote role${r.leads.length>1?'s':''}; the best fit is ${best.title} at ${best.company}${best.pay?`, ${best.pay}`:''}.${r.letter?' A cover letter is drafted in the Jobs panel.':''}`;
 }
}
