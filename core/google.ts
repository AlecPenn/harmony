/** Google (Phase 17): read-only Calendar and Gmail, through OAuth done properly for a desktop app.
 *
 * - Alec's own Google Cloud "Desktop app" client (imported from its JSON file; HARMONY ships no Google client).
 * - Loopback redirect on 127.0.0.1 with a random port, PKCE (S256), a random state, a 5-minute limit.
 * - Separate scope sets. Desktop apps cannot add scopes incrementally, so a new capability means a new, visible
 *   sign-in listing exactly what is asked for; scopes are never enlarged silently.
 * - The refresh token and client file are encrypted with Windows' protected storage (safeStorage/DPAPI); nothing is
 *   written in plain text. Access tokens live in memory only.
 * - Mail and calendar text is untrusted: it is shown to the model only as a function result in a pass that cannot run
 *   actions, exactly like web results.
 */
import {createHash,randomBytes} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {readFileSync,writeFileSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import type {WebResult} from './web.ts';

export const GOOGLE_SCOPES={
 calendar:'https://www.googleapis.com/auth/calendar.readonly',
 gmail:'https://www.googleapis.com/auth/gmail.readonly',
} as const;
export type GoogleCapability=keyof typeof GOOGLE_SCOPES;
export interface CalendarEvent {id:string;start:Date;allDay:boolean;title:string;where:string;cal:string;}
export interface GoogleStatus {clientImported:boolean;connected:boolean;email:string|null;capabilities:GoogleCapability[];needsReconnect:boolean;error:string|null;}
export const emptyGoogle:GoogleStatus={clientImported:false,connected:false,email:null,capabilities:[],needsReconnect:false,error:null};
export interface Cipher {available():Promise<boolean>;encrypt(text:string):Promise<Buffer>;decrypt(data:Buffer):Promise<string>;}
interface Saved {clientId:string;clientSecret:string|null;refreshToken:string|null;scopes:string[];email:string|null;}
export class GoogleError extends Error {}
export interface MailMeta {id:string;threadId:string;from:string;fromEmail:string;to:string;cc:string;subject:string;date:string;snippet:string;labels:string[];bulk:boolean;messageId:string;}

/** A Google Cloud "Desktop app" OAuth client file ({"installed":{...}}). Web clients are refused. */
export function parseClientFile(text:string):{clientId:string;clientSecret:string|null}{
 let json:unknown;try{json=JSON.parse(text);}catch{throw new GoogleError('That is not a Google client file.');}
 const inst=(json as {installed?:Record<string,unknown>;web?:unknown})?.installed;
 if(!inst){throw new GoogleError((json as {web?:unknown})?.web?'That client is a "Web application". Create a "Desktop app" client instead.':'That is not a Google client file.');}
 const id=inst.client_id,secret=inst.client_secret;
 if(typeof id!=='string'||!/^[\w-]{5,100}\.apps\.googleusercontent\.com$/.test(id))throw new GoogleError('The client file has no valid client ID.');
 return {clientId:id,clientSecret:typeof secret==='string'&&secret.length<=200?secret:null};
}
const b64url=(b:Buffer)=>b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

export class GoogleAccount {
 private path:string;private cipher:Cipher;private fetcher:typeof fetch;private now:()=>number;
 #saved:Saved|null=null;#loaded=false;#access:{token:string;until:number}|null=null;#status:GoogleStatus={...emptyGoogle};#pending:Server|null=null;
 constructor(path:string,cipher:Cipher,fetcher:typeof fetch=fetch,now:()=>number=Date.now){this.path=path;this.cipher=cipher;this.fetcher=fetcher;this.now=now;}

 async #load(){
  if(this.#loaded)return;this.#loaded=true;
  try{if(existsSync(this.path))this.#saved=JSON.parse(await this.cipher.decrypt(readFileSync(this.path)));}catch{this.#saved=null;this.#status.error='Saved Google sign-in could not be read. Import the client file again.';}
  this.#refreshStatus();
 }
 async #save(){
  if(!await this.cipher.available())throw new GoogleError('Windows protected storage is not available, so the sign-in cannot be saved safely.');
  mkdirSync(dirname(this.path),{recursive:true});
  if(this.#saved)writeFileSync(this.path,await this.cipher.encrypt(JSON.stringify(this.#saved)));else if(existsSync(this.path))rmSync(this.path);
  this.#refreshStatus();
 }
 #refreshStatus(){
  const s=this.#saved,caps=(Object.keys(GOOGLE_SCOPES) as GoogleCapability[]).filter(c=>s?.scopes.includes(GOOGLE_SCOPES[c]));
  this.#status={...this.#status,clientImported:!!s,connected:!!s?.refreshToken,email:s?.email??null,capabilities:s?.refreshToken?caps:[]};
 }
 async status():Promise<GoogleStatus>{await this.#load();return {...this.#status,capabilities:[...this.#status.capabilities]};}
 snapshot():GoogleStatus{return {...this.#status,capabilities:[...this.#status.capabilities]};}
 has(cap:GoogleCapability){return this.#status.connected&&this.#status.capabilities.includes(cap);}

 async importClient(text:string){
  await this.#load();const c=parseClientFile(text);
  const same=this.#saved?.clientId===c.clientId;
  this.#saved={clientId:c.clientId,clientSecret:c.clientSecret,refreshToken:same?this.#saved!.refreshToken:null,scopes:same?this.#saved!.scopes:[],email:same?this.#saved!.email:null};
  this.#access=null;this.#status.error=null;await this.#save();
 }

 /** Opens Google's consent page in the browser for exactly these capabilities and waits for the loopback callback. */
 async connect(caps:GoogleCapability[],openUrl:(url:string)=>void|Promise<void>,timeoutMs=5*60_000):Promise<GoogleStatus>{
  await this.#load();const s=this.#saved;if(!s)throw new GoogleError('Import your Google client file first.');
  if(this.#pending)throw new GoogleError('A Google sign-in is already waiting in your browser.');
  const scopes=[...new Set(caps)].filter(c=>c in GOOGLE_SCOPES).map(c=>GOOGLE_SCOPES[c]);if(!scopes.length)throw new GoogleError('Choose what HARMONY may read.');
  const verifier=b64url(randomBytes(48)),challenge=b64url(createHash('sha256').update(verifier).digest()),state=b64url(randomBytes(24));
  const server=createServer();this.#pending=server;
  try{
   const port=await new Promise<number>((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',()=>ok((server.address() as {port:number}).port));});
   const redirect=`http://127.0.0.1:${port}`;
   const code=await new Promise<string>((ok,bad)=>{
    const timer=setTimeout(()=>bad(new GoogleError('The Google sign-in timed out. Try again.')),timeoutMs);
    server.on('request',(req,res)=>{
     const url=new URL(req.url??'/',redirect);
     if(url.pathname!=='/'){res.writeHead(404).end();return;}
     const done=(text:string)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(`<!doctype html><title>HARMONY</title><body style="font-family:sans-serif;background:#0e0c1f;color:#fff;padding:40px"><h2>${text}</h2><p>You can close this tab.</p>`);};
     if(url.searchParams.get('state')!==state){done('That sign-in link was not from HARMONY.');return;}
     clearTimeout(timer);
     const err=url.searchParams.get('error'),c=url.searchParams.get('code');
     if(err||!c){done('Google sign-in was cancelled.');bad(new GoogleError(err==='access_denied'?'You declined the Google permissions.':'Google sign-in did not complete.'));return;}
     done('HARMONY is connected to Google.');ok(c);
    });
    const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for(const [k,v] of Object.entries({client_id:s.clientId,redirect_uri:redirect,response_type:'code',scope:scopes.join(' '),code_challenge:challenge,code_challenge_method:'S256',state,access_type:'offline',prompt:'consent'}))auth.searchParams.set(k,v);
    Promise.resolve(openUrl(auth.toString())).catch(()=>{clearTimeout(timer);bad(new GoogleError('Could not open the browser.'));});
   });
   const t=await this.#token({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:redirect});
   if(typeof t.refresh_token!=='string')throw new GoogleError('Google did not return a lasting sign-in. Remove HARMONY from your Google account permissions and try again.');
   const granted=typeof t.scope==='string'?t.scope.split(' '):scopes;
   this.#saved={...s,refreshToken:t.refresh_token,scopes:granted.filter(x=>Object.values(GOOGLE_SCOPES).includes(x as never))};
   this.#access={token:t.access_token,until:this.now()+Math.max(60,Number(t.expires_in)||3600)*1000-60_000};
   this.#status.needsReconnect=false;this.#status.error=null;
   if(this.#saved.scopes.includes(GOOGLE_SCOPES.gmail)){try{const p=await this.#api('https://gmail.googleapis.com/gmail/v1/users/me/profile');this.#saved.email=typeof p.emailAddress==='string'?p.emailAddress:null;}catch{}}
   await this.#save();return this.status();
  }finally{this.#pending=null;server.close();}
 }

 async disconnect(){
  await this.#load();const token=this.#saved?.refreshToken;
  if(token)try{await this.fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}).toString(),signal:AbortSignal.timeout(8000)});}catch{}
  if(this.#saved)this.#saved={...this.#saved,refreshToken:null,scopes:[],email:null};
  this.#access=null;this.#status.needsReconnect=false;await this.#save();
 }
 /** Removes the client file and sign-in from this PC entirely. */
 async forget(){await this.disconnect();this.#saved=null;await this.#save();}

 async #token(params:Record<string,string>):Promise<Record<string,any>>{
  const s=this.#saved!;
  const body=new URLSearchParams({client_id:s.clientId,...(s.clientSecret?{client_secret:s.clientSecret}:{}),...params});
  let res:Response;
  try{res=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),signal:AbortSignal.timeout(10000)});}
  catch{throw new GoogleError('Could not reach Google.');}
  const json=await res.json().catch(()=>({})) as Record<string,any>;
  if(!res.ok){
   if(json.error==='invalid_grant'){this.#status.needsReconnect=true;throw new GoogleError('Your Google sign-in has expired. Reconnect Google in Settings.');}
   throw new GoogleError('Google refused the sign-in.');
  }
  return json;
 }
 async #accessToken():Promise<string>{
  await this.#load();const s=this.#saved;if(!s?.refreshToken)throw new GoogleError('Google is not connected. Connect it in Settings.');
  if(this.#access&&this.#access.until>this.now())return this.#access.token;
  const t=await this.#token({grant_type:'refresh_token',refresh_token:s.refreshToken});
  this.#access={token:String(t.access_token),until:this.now()+Math.max(60,Number(t.expires_in)||3600)*1000-60_000};
  return this.#access.token;
 }
 async #api(url:string,signal?:AbortSignal):Promise<Record<string,any>>{
  const token=await this.#accessToken();
  let res:Response;
  try{res=await this.fetcher(url,{headers:{Authorization:`Bearer ${token}`},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});}
  catch{signal?.throwIfAborted();throw new GoogleError('Could not reach Google.');}
  if(res.status===401){this.#access=null;throw new GoogleError('Google rejected the request. Try again, or reconnect Google in Settings.');}
  if(res.status===403)throw new GoogleError('HARMONY does not have that Google permission. Connect it in Settings.');
  if(!res.ok)throw new GoogleError(`Google returned an error (${res.status}).`);
  return await res.json() as Record<string,any>;
 }

 /** Structured events in a range (all visible calendars), earliest first. Read-only. */
 async events(range:{start:Date;end:Date},signal:AbortSignal):Promise<CalendarEvent[]>{
  if(!this.has('calendar'))throw new GoogleError('Calendar is not connected. Connect it in Settings.');
  const list=await this.#api('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=20',signal);
  const cals=(Array.isArray(list.items)?list.items:[]).filter((c:any)=>c.selected!==false&&!c.hidden).slice(0,8);
  const events:CalendarEvent[]=[];
  for(const c of cals){
   const u=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events`);
   for(const [k,v] of Object.entries({timeMin:range.start.toISOString(),timeMax:range.end.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'25'}))u.searchParams.set(k,v);
   const r=await this.#api(u.toString(),signal);
   for(const e of Array.isArray(r.items)?r.items:[]){
    if(e.status==='cancelled')continue;
    const allDay=!e.start?.dateTime,start=new Date(e.start?.dateTime??`${e.start?.date}T00:00:00`);
    if(Number.isNaN(start.getTime()))continue;
    events.push({id:String(e.id??'').slice(0,200),start,allDay,title:String(e.summary??'(no title)').slice(0,120),where:String(e.location??'').slice(0,80),cal:c.primary?'':String(c.summary??'').slice(0,40)});
   }
  }
  return events.sort((a,b)=>a.start.getTime()-b.start.getTime());
 }
 /** Events on all calendars Alec can see, in a time range. Read-only. */
 async calendar(range:{start:Date;end:Date;label:string},signal:AbortSignal):Promise<WebResult>{
  const events=await this.events(range,signal);

  const day=(d:Date)=>d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),time=(d:Date)=>d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  const lines=[`Google Calendar, ${range.label}:`,...(events.length?events.slice(0,15).map(e=>`- ${day(e.start)} ${e.allDay?'all day':time(e.start)}: ${e.title}${e.where?` at ${e.where}`:''}${e.cal?` (${e.cal})`:''}`):['- Nothing scheduled.'])];
  return {kind:'search',query:`calendar ${range.label}`,retrievedAt:new Date(this.now()).toISOString(),text:lines.join('\n').slice(0,1600),sources:[{title:'Google Calendar',url:'https://calendar.google.com/',site:'Google Calendar'}]};
 }

 /** Gmail search (Gmail's own query syntax). Sender, subject, date and a short snippet only; never full bodies. */
 async mail(query:string,signal:AbortSignal):Promise<WebResult>{
  if(!this.has('gmail'))throw new GoogleError('Gmail is not connected. Connect it in Settings.');
  const q=query.trim().slice(0,200)||'is:unread newer_than:2d';
  const list=await this.#api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=6&q=${encodeURIComponent(q)}`,signal);
  const ids=(Array.isArray(list.messages)?list.messages:[]).map((m:any)=>String(m.id)).filter((id:string)=>/^[\w-]{6,64}$/.test(id)).slice(0,6);
  const lines=[`Gmail messages matching "${q}"${typeof list.resultSizeEstimate==='number'&&list.resultSizeEstimate>ids.length?` (about ${list.resultSizeEstimate}; newest ${ids.length} shown)`:''}:`];
  const sources=[];
  for(const id of ids){
   const m=await this.#api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,signal);
   const h=(n:string)=>String((m.payload?.headers??[]).find((x:any)=>String(x.name).toLowerCase()===n)?.value??'');
   const from=h('from').replace(/\s*<[^>]*>/,'').replace(/"/g,'').slice(0,60)||'unknown sender',subject=h('subject').slice(0,120)||'(no subject)';
   const date=new Date(Number(m.internalDate));
   lines.push(`- From ${from}, ${Number.isNaN(date.getTime())?'':date.toLocaleDateString('en-US',{month:'short',day:'numeric'})}: "${subject}" — ${String(m.snippet??'').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').slice(0,110)}`);
   sources.push({title:subject,url:`https://mail.google.com/mail/u/0/#all/${id}`,site:'Gmail'});
  }
  if(!ids.length)lines.push('- No matching messages.');
  return {kind:'search',query:`mail ${q}`,retrievedAt:new Date(this.now()).toISOString(),text:lines.join('\n').slice(0,1600),sources:sources.slice(0,6)};
 }
 /** Structured messages for triage: headers, labels and Gmail's snippet (no bodies). Read-only. */
 async messages(query:string,max:number,signal?:AbortSignal):Promise<MailMeta[]>{
  if(!this.has('gmail'))throw new GoogleError('Gmail is not connected. Connect it in Settings.');
  const list=await this.#api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${Math.min(40,Math.max(1,max))}&q=${encodeURIComponent(query.slice(0,200))}`,signal);
  const ids=(Array.isArray(list.messages)?list.messages:[]).map((m:any)=>String(m.id)).filter((id:string)=>/^[\w-]{6,64}$/.test(id));
  const out:MailMeta[]=[];
  for(const id of ids){
   const m=await this.#api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=List-Unsubscribe&metadataHeaders=Message-ID`,signal);
   const h=(n:string)=>String((m.payload?.headers??[]).find((x:any)=>String(x.name).toLowerCase()===n)?.value??'');
   const from=h('from'),email=(from.match(/<([^>]+)>/)?.[1]??from).trim().toLowerCase().slice(0,120);
   out.push({id,threadId:String(m.threadId??id).slice(0,64),from:from.replace(/\s*<[^>]*>/,'').replace(/"/g,'').trim().slice(0,80)||email,fromEmail:email,
    to:h('to').slice(0,300),cc:h('cc').slice(0,300),subject:h('subject').slice(0,160)||'(no subject)',date:new Date(Number(m.internalDate)||Date.now()).toISOString(),
    snippet:String(m.snippet??'').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&').slice(0,240),labels:(Array.isArray(m.labelIds)?m.labelIds:[]).map(String).slice(0,20),
    bulk:!!h('list-unsubscribe'),messageId:h('message-id').slice(0,200)});
  }
  return out;
 }
 /** One message's plain text, for drafting a reply on this PC. Capped; HTML is reduced to text. Read-only. */
 async messageText(id:string,signal?:AbortSignal):Promise<string>{
  if(!this.has('gmail')||!/^[\w-]{6,64}$/.test(id))throw new GoogleError('Gmail is not connected. Connect it in Settings.');
  const m=await this.#api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,signal);
  const parts:any[]=[];const walk=(p:any,d=0)=>{if(!p||d>8)return;parts.push(p);for(const c of Array.isArray(p.parts)?p.parts:[])walk(c,d+1);};walk(m.payload);
  const pick=parts.find(p=>p.mimeType==='text/plain'&&p.body?.data)??parts.find(p=>p.mimeType==='text/html'&&p.body?.data);
  if(!pick)return String(m.snippet??'');
  let t=Buffer.from(String(pick.body.data).replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
  if(pick.mimeType==='text/html')t=t.replace(/<(script|style)[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>|<\/p>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
  // Drop quoted history: what matters is the newest message.
  t=t.split(/\n(?:On .{5,120} wrote:|-{2,} ?Original Message|From: .{3,120}\nSent: )/)[0];
  return t.replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').replace(/[ \t]{2,}/g,' ').trim().slice(0,4000);
 }

}

/** "today", "tomorrow", "this week", "next 3 days", a weekday or 2026-10-23, in local time. */
export function calendarRange(when:string,now=new Date()):{start:Date;end:Date;label:string}{
 const w=when.trim().toLowerCase(),day=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
 const at=(offset:number,days=1,label=w)=>{const s=day(now);s.setDate(s.getDate()+offset);const e=new Date(s);e.setDate(e.getDate()+days);return {start:offset===0?now:s,end:e,label};};
 if(!w||w==='today'||w==='rest of today')return at(0,1,'today');
 if(w==='tomorrow')return at(1,1,'tomorrow');
 if(/^(this|the) week|^next 7 days|^week$/.test(w))return at(0,7,'the next 7 days');
 const n=w.match(/^next (\d{1,2}) days?$/);if(n)return at(0,Math.min(31,+n[1]),`the next ${n[1]} days`);
 if(/^next week$/.test(w)){const s=day(now);s.setDate(s.getDate()+((8-s.getDay())%7||7));const e=new Date(s);e.setDate(e.getDate()+7);return {start:s,end:e,label:'next week'};}
 const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],i=names.findIndex(d=>w.replace(/^(on |this |next )/,'')===d);
 if(i>=0){const diff=(i-now.getDay()+7)%7||(w.startsWith('next')?7:0);return at(diff,1,names[i][0].toUpperCase()+names[i].slice(1));}
 const iso=w.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(iso){const s=new Date(+iso[1],+iso[2]-1,+iso[3]);if(!Number.isNaN(s.getTime())){const e=new Date(s);e.setDate(e.getDate()+1);return {start:s,end:e,label:s.toDateString()};}}
 return at(0,1,'today');
}
