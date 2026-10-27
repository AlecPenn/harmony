import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import type {DatabaseSync} from 'node:sqlite';
import {COMPANION_PAGE} from './companion-page.ts';

/** Phase 39, phone companion (first version): a small page on your phone, over your home Wi-Fi only, to type to HARMONY
 * (your phone keyboard's microphone works for dictation), capture ideas, see notices, reminders and research, and press
 * STOP. Off by default. A phone must be paired with a 6-digit code shown in Settings; it then holds a random token that is
 * stored here only as a hash and can be forgotten at any time. Requests from outside your local network are refused. */
export interface CompanionDevice {id:string;name:string;hash:string;createdAt:string;lastSeen:string|null;
 /** The phone's secret, sealed with Windows encryption: lets HARMONY check signed requests (approvals) without the
  * secret ever crossing the network again after pairing. Absent on phones paired before signing existed. */
 key?:string;}
/** Synchronous seal for the device secret (Electron safeStorage on Windows). */
export interface DeviceSeal {seal(text:string):string;open(sealed:string):string;}
/** Approvals and locking for the phone (the guardian). */
export interface CompanionGuard {
 pending():unknown[];answer(id:string,answer:{approve:boolean;pick:number|null;trust:boolean}):string;lock():void;unlock():void;
}
export interface CompanionStatus {enabled:boolean;port:number;addresses:string[];code:string|null;codeExpires:string|null;devices:{id:string;name:string;createdAt:string;lastSeen:string|null}[];error:string|null;}
export interface CompanionDeps {state():unknown;ask(text:string):void;stop():Promise<void>;changed():void;guard?:CompanionGuard;}
export const PORT=47800,MAX_DEVICES=5,CODE_MS=10*60000,MAX_ATTEMPTS=5,MAX_BODY=8192;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

/** Loopback and private (RFC 1918 / link-local / ULA) addresses only. */
export function isLocalAddress(address:string|undefined):boolean{
 if(!address)return false;const a=address.replace(/^::ffff:/,'');
 return a==='127.0.0.1'||a==='::1'||/^10\./.test(a)||/^192\.168\./.test(a)||/^172\.(1[6-9]|2\d|3[01])\./.test(a)||/^169\.254\./.test(a)||/^f[cd][0-9a-f]{2}:/i.test(a)||/^fe80:/i.test(a);
}
export function lanAddresses():string[]{return Object.values(networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal&&isLocalAddress(i.address)).map(i=>i!.address);}

export const SIGN_WINDOW_MS=60000;
/** What the phone signs: method, path, time, nonce and a hash of the body, joined by newlines. */
export const signingText=(method:string,path:string,time:string,nonce:string,body:string)=>`${method}\n${path}\n${time}\n${nonce}\n${sha(body)}`;
export class CompanionAuth {
 #code:{value:string;expires:number;attempts:number}|null=null;#nonces=new Map<string,number>();
 private db:DatabaseSync;private now:()=>number;private seal:DeviceSeal|null;
 constructor(db:DatabaseSync,now:()=>number=Date.now,seal:DeviceSeal|null=null){this.db=db;this.now=now;this.seal=seal;}
 devices():CompanionDevice[]{try{const r=this.db.prepare("SELECT value FROM memory_settings WHERE key='companion_devices'").get();const v=r?JSON.parse(String(r.value)):[];return Array.isArray(v)?v:[];}catch{return [];}}
 #save(list:CompanionDevice[]){this.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('companion_devices',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(list.slice(0,MAX_DEVICES)));}
 newCode():string{const value=String(randomInt(0,1_000_000)).padStart(6,'0');this.#code={value,expires:this.now()+CODE_MS,attempts:0};return value;}
 get code(){return this.#code&&this.now()<this.#code.expires?{value:this.#code.value,expires:this.#code.expires}:null;}
 clearCode(){this.#code=null;}
 /** One code, 10 minutes, 5 tries; success uses it up. Returns the new token, shown to the phone once. */
 pair(code:unknown,name:unknown):string|null{
  const c=this.#code;if(!c||this.now()>=c.expires||typeof code!=='string')return null;
  if(++c.attempts>MAX_ATTEMPTS){this.#code=null;return null;}
  const a=Buffer.from(code.padEnd(6).slice(0,6)),b=Buffer.from(c.value);if(!timingSafeEqual(a,b))return null;
  this.#code=null;
  const token=randomBytes(32).toString('hex'),list=this.devices();
  if(list.length>=MAX_DEVICES)list.shift();
  let key:string|undefined;try{key=this.seal?.seal(token);}catch{key=undefined;}
  list.push({id:randomBytes(8).toString('hex'),name:String(name??'Phone').replace(/[^\p{L}\p{N} '._-]+/gu,'').slice(0,40)||'Phone',hash:sha(token),createdAt:new Date(this.now()).toISOString(),lastSeen:null,...(key?{key}:{})});
  this.#save(list);return token;
 }
 /** The paired device for a bearer token, or null. */
 check(header:unknown):CompanionDevice|null{
  if(typeof header!=='string')return null;const m=header.match(/^Bearer ([0-9a-f]{64})$/);if(!m)return null;
  const h=Buffer.from(sha(m[1]),'hex'),list=this.devices();
  const d=list.find(x=>{try{return timingSafeEqual(Buffer.from(x.hash,'hex'),h);}catch{return false;}});
  if(d){d.lastSeen=new Date(this.now()).toISOString();this.#save(list);}
  return d??null;
 }
 /** A signed request: device id, time within a minute, a nonce never seen before, and an HMAC-SHA256 over the request
  * with the phone's secret. The secret itself is not sent, so someone watching the Wi-Fi can't reuse it, and a
  * captured request can't be replayed. Returns the device, or null. */
 verify(headers:Record<string,unknown>,method:string,path:string,body:string):CompanionDevice|null{
  const id=headers['x-harmony-device'],time=headers['x-harmony-time'],nonce=headers['x-harmony-nonce'],sig=headers['x-harmony-sig'];
  if(typeof id!=='string'||!/^[0-9a-f]{16}$/.test(id)||typeof time!=='string'||!/^\d{13}$/.test(time)||typeof nonce!=='string'||!/^[0-9a-f]{32}$/.test(nonce)||typeof sig!=='string'||!/^[0-9a-f]{64}$/.test(sig))return null;
  const now=this.now();if(Math.abs(now-Number(time))>SIGN_WINDOW_MS)return null;
  for(const [n,t] of this.#nonces)if(t<now)this.#nonces.delete(n);
  if(this.#nonces.has(nonce)||this.#nonces.size>5000)return null;
  const list=this.devices(),d=list.find(x=>x.id===id);if(!d?.key||!this.seal)return null;
  let secret:string;try{secret=this.seal.open(d.key);}catch{return null;}
  const want=createHmac('sha256',secret).update(signingText(method,path,time,nonce,body)).digest();
  if(!timingSafeEqual(want,Buffer.from(sig,'hex')))return null;
  this.#nonces.set(nonce,now+2*SIGN_WINDOW_MS);
  d.lastSeen=new Date(now).toISOString();this.#save(list);return d;
 }
 idFor(token:string):string|null{const h=sha(token);return this.devices().find(d=>d.hash===h)?.id??null;}
 /** True when some phone can sign approvals. */
 get signing(){return this.devices().some(d=>!!d.key);}
 forget(id:string):boolean{const list=this.devices(),next=list.filter(d=>d.id!==id);if(next.length===list.length)return false;this.#save(next);return true;}
}

export class CompanionServer {
 #server:Server|null=null;#error:string|null=null;
 private auth:CompanionAuth;private deps:CompanionDeps;private db:DatabaseSync;readonly port:number;
 constructor(db:DatabaseSync,auth:CompanionAuth,deps:CompanionDeps,port=PORT){this.db=db;this.auth=auth;this.deps=deps;this.port=port;}
 get enabled(){return this.db.prepare("SELECT value FROM memory_settings WHERE key='companion'").get()?.value==='on';}
 setEnabled(on:boolean){this.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('companion',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(on?'on':'off');if(on)this.start();else void this.stop();this.deps.changed();}
 start(){
  if(this.#server||!this.enabled)return;
  const server=createServer((req,res)=>{void this.handle(req,res);});
  server.on('error',e=>{this.#error=(e as NodeJS.ErrnoException).code==='EADDRINUSE'?`Port ${this.port} is in use.`:'The companion could not start.';this.#server=null;this.deps.changed();});
  server.listen(this.port,'0.0.0.0',()=>{this.#error=null;this.deps.changed();});
  this.#server=server;
 }
 stop():Promise<void>{const s=this.#server;this.#server=null;this.auth.clearCode();return s?new Promise(r=>s.close(()=>r())):Promise.resolve();}
 status():CompanionStatus{const c=this.auth.code;return {enabled:this.enabled,port:this.port,addresses:this.enabled?lanAddresses():[],code:c?.value??null,codeExpires:c?new Date(c.expires).toISOString():null,
  devices:this.auth.devices().map(({id,name,createdAt,lastSeen})=>({id,name,createdAt,lastSeen})),error:this.#error};}
 async handle(req:IncomingMessage,res:ServerResponse){
  const send=(status:number,body:unknown,type='application/json')=>{
   res.writeHead(status,{'Content-Type':type==='application/json'?'application/json; charset=utf-8':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'X-Frame-Options':'DENY'});
   res.end(type==='application/json'?JSON.stringify(body):String(body));};
  try{
   if(!isLocalAddress(req.socket.remoteAddress))return send(403,{error:'Local network only'});
   const url=new URL(req.url??'/','http://x');
   if(req.method==='GET'&&url.pathname==='/')return send(200,COMPANION_PAGE,'text/html; charset=utf-8');
   if(!url.pathname.startsWith('/api/'))return send(404,{error:'Not found'});
   // Browsers send Origin on cross-site requests: only this page's own origin may call the API.
   const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`)return send(403,{error:'Wrong origin'});
   let body:Record<string,unknown>={},raw='';
   if(req.method==='POST'){
    if(!/^application\/json/.test(String(req.headers['content-type']??'')))return send(415,{error:'JSON only'});
    for await(const chunk of req){raw+=chunk;if(raw.length>MAX_BODY)return send(413,{error:'Too large'});}
    try{const v=JSON.parse(raw||'{}');body=v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return send(400,{error:'Bad JSON'});}
   }
   if(req.method==='POST'&&url.pathname==='/api/pair'){
    const token=this.auth.pair(body.code,body.name);this.deps.changed();
    return token?send(200,{token,device:this.auth.idFor(token)}):send(401,{error:'That code is wrong or has expired. Get a new one in HARMONY > Settings.'});
   }
   const signed=this.auth.verify(req.headers as Record<string,unknown>,req.method??'GET',url.pathname,raw);
   const device=signed??this.auth.check(req.headers.authorization);if(!device)return send(401,{error:'Not paired'});
   const guard=this.deps.guard;
   if(url.pathname==='/api/approvals'&&req.method==='GET')return send(200,{approvals:guard&&signed?guard.pending():[],signed:!!signed});
   if(url.pathname==='/api/approve'&&req.method==='POST'){
    // Approving needs a signed request: a bare token (older pairing) can't approve anything.
    if(!signed||!guard)return send(403,{error:'Pair this phone again to approve things.'});
    const id=typeof body.id==='string'&&/^[0-9a-f]{16}$/.test(body.id)?body.id:null,pick=Number.isInteger(body.pick)?body.pick as number:null;
    if(!id||typeof body.approve!=='boolean')return send(400,{error:'Bad answer'});
    return send(200,{result:guard.answer(id,{approve:body.approve,pick,trust:body.trust===true})});
   }
   if(url.pathname==='/api/lock'&&req.method==='POST'){guard?.lock();return send(200,{ok:true});}
   // Unlocking needs the phone's signature (proof it's your paired phone), never a bare token.
   if(url.pathname==='/api/unlock'&&req.method==='POST'){if(!signed||!guard)return send(403,{error:'Pair this phone again to unlock.'});guard.unlock();return send(200,{ok:true});}
   if(req.method==='GET'&&url.pathname==='/api/state')return send(200,this.deps.state());
   if(req.method==='POST'&&url.pathname==='/api/ask'){
    const text=typeof body.text==='string'?body.text.trim():'';if(!text||text.length>2000)return send(400,{error:'Say something (up to 2000 characters).'});
    try{this.deps.ask(text);return send(202,{ok:true});}catch(e){return send(409,{error:e instanceof Error&&e.message.length<120?e.message:'HARMONY is busy right now.'});}
   }
   if(req.method==='POST'&&url.pathname==='/api/stop'){await this.deps.stop().catch(()=>{});return send(200,{ok:true});}
   return send(404,{error:'Not found'});
  }catch{try{send(500,{error:'Something went wrong'});}catch{}}
 }
}
