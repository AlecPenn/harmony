import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {isAbsolute,join,resolve} from 'node:path';
import type {ProfileCipher} from '../packages/identity/vault.ts';
import {ProtectedSettings} from './protected-settings.ts';
import {stat as statAsync} from 'node:fs/promises';
/** Whether a backup place is there, without blocking: a disconnected network drive can take many seconds to answer. */
export async function reachable(path:string,ms=1500):Promise<boolean>{
 return Promise.race([statAsync(path).then(s=>s.isDirectory(),()=>false),new Promise<boolean>(r=>{const t=setTimeout(()=>r(false),ms);t.unref?.();})]);
}

/** Step 16: off-PC backups. The daily backup (database and settings) is also written, encrypted, to folders off this
 * disk: the OneDrive folder (synced to the cloud by OneDrive itself), another drive, or a USB stick.
 *
 * Encryption is AES-256-GCM with a random 256-bit **recovery key** that HARMONY shows Alec once to save somewhere safe.
 * It is not tied to Windows (a copy locked to this PC would be useless if the PC died). HARMONY keeps the key sealed
 * with Windows encryption so the daily copies are automatic. Restoring on a new PC needs the recovery key.
 * Voice and face prints, passwords and keys are never included. They stay locked to this Windows account. */

const MAGIC=Buffer.from('HARMONY-OFFSITE\u0001','latin1'); // 16 bytes: name and format version
export const FOLDER='HARMONY Backups',KEEP=14;
const FILE=/^harmony-offsite-(\d{8}-\d{6})\.hbk$/;
const ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: easy to copy by hand (31 symbols)

export function keyId(key:Buffer){return createHash('sha256').update(key).digest('hex').slice(0,12);}
/** The key as 13 groups of 4 symbols (base 31, big-endian), for writing down or saving. */
export function recoveryText(key:Buffer):string{
 let n=BigInt('0x'+key.toString('hex'));const out:string[]=[];
 for(let i=0;i<52;i++){out.push(ALPHABET[Number(n%31n)]);n/=31n;}
 return out.reverse().join('').match(/.{4}/g)!.join('-');
}
export function parseRecovery(text:string):Buffer|null{
 const s=text.toUpperCase().replace(/[\s-]+/g,'').replace(/0/g,'O'); // 0 is read as O; 1, I and L aren't in the alphabet
 if(s.length!==52||[...s].some(c=>!ALPHABET.includes(c)))return null;
 let n=0n;for(const c of s)n=n*31n+BigInt(ALPHABET.indexOf(c));
 if(n>=1n<<256n)return null;
 return Buffer.from(n.toString(16).padStart(64,'0'),'hex');
}
export interface Payload {at:string;files:Record<string,Buffer>;}
/** header (magic, key id, nonce) is authenticated; the body is gzip(JSON) of the files. */
export function seal(key:Buffer,p:Payload):Buffer{
 const nonce=randomBytes(12),header=Buffer.concat([MAGIC,Buffer.from(keyId(key),'latin1'),nonce]);
 const body=gzipSync(Buffer.from(JSON.stringify({at:p.at,files:Object.fromEntries(Object.entries(p.files).map(([k,v])=>[k,v.toString('base64')]))})));
 const c=createCipheriv('aes-256-gcm',key,nonce);c.setAAD(header);
 const enc=Buffer.concat([c.update(body),c.final()]);return Buffer.concat([header,enc,c.getAuthTag()]);
}
export class WrongKey extends Error {}
export function open(key:Buffer,data:Buffer):Payload{
 if(data.length<16+12+12+16||!data.subarray(0,16).equals(MAGIC))throw new Error('Not a HARMONY off-PC backup');
 const id=data.subarray(16,28).toString('latin1');if(id!==keyId(key))throw new WrongKey('That recovery key doesn\'t match this backup.');
 const header=data.subarray(0,40),nonce=data.subarray(28,40),tag=data.subarray(data.length-16);
 const d=createDecipheriv('aes-256-gcm',key,nonce);d.setAAD(header);d.setAuthTag(tag);
 let body:Buffer;try{body=Buffer.concat([d.update(data.subarray(40,data.length-16)),d.final()]);}catch{throw new Error('This backup is damaged or was changed.');}
 const v=JSON.parse(gunzipSync(body,{maxOutputLength:512*1024*1024}).toString('utf8')) as {at:string;files:Record<string,string>};
 return {at:v.at,files:Object.fromEntries(Object.entries(v.files).map(([k,b])=>[k,Buffer.from(b,'base64')]))};
}

interface Stored {v:1;key:string;confirmed:boolean;on:boolean;targets:string[];}
function validate(v:unknown):Stored{
 const o=v as Partial<Stored>;
 if(!o||o.v!==1||typeof o.key!=='string'||!/^[0-9a-f]{64}$/.test(o.key))throw new Error('Invalid off-PC backup settings');
 const targets=(Array.isArray(o.targets)?o.targets:[]).filter((t):t is string=>typeof t==='string'&&t.length<300&&isAbsolute(t)).slice(0,4);
 return {v:1,key:o.key,confirmed:o.confirmed===true,on:o.on===true,targets};
}
const stamp=(d:Date)=>d.toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
export interface TargetStatus {path:string;reachable:boolean;newest:string|null;count:number;}
export interface OffsiteStatus {set:boolean;confirmed:boolean;on:boolean;targets:TargetStatus[];newest:string|null;error:string|null;}

export class OffsiteBackups {
 #store:ProtectedSettings<Stored>;#error:string|null=null;
 private now:()=>Date;
 constructor(path:string,cipher:ProfileCipher,now:()=>Date=()=>new Date()){this.#store=new ProtectedSettings(path,cipher,validate);this.now=now;}
 static list(folder:string):{name:string;at:string}[]{
  try{return readdirSync(folder).map(n=>n.match(FILE)).filter((m):m is RegExpMatchArray=>!!m)
   .map(m=>({name:m[0],at:new Date(`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}T${m[1].slice(9,11)}:${m[1].slice(11,13)}:${m[1].slice(13,15)}Z`).toISOString()}))
   .sort((a,b)=>b.at.localeCompare(a.at));}catch{return [];}
 }
 async status():Promise<OffsiteStatus>{
  let s:Stored|null=null;try{s=await this.#store.read();}catch{}
  const targets=await Promise.all((s?.targets??[]).map(async t=>{const ok=await reachable(t),list=ok?OffsiteBackups.list(join(t,FOLDER)):[];
   return {path:t,reachable:ok,newest:list[0]?.at??null,count:list.length};}));
  const newest=targets.map(t=>t.newest).filter((x):x is string=>!!x).sort().at(-1)??null;
  return {set:!!s,confirmed:!!s?.confirmed,on:!!s?.on,targets,newest,error:this.#error};
 }
 /** Turns it on with these folders. A new recovery key is made the first time (returned once, to show Alec). */
 async enable(targets:string[]):Promise<{recovery:string|null}>{
  const clean=[...new Set(targets.map(t=>resolve(t)))].filter(t=>isAbsolute(t)).slice(0,4);
  if(!clean.length)throw new Error('Pick at least one place for the off-PC copies.');
  const old=await this.#store.read().catch(()=>null);
  const key=old?.key??randomBytes(32).toString('hex');
  await this.#store.save({v:1,key,confirmed:old?.confirmed??false,on:true,targets:clean});
  return {recovery:old?.confirmed?null:recoveryText(Buffer.from(key,'hex'))};
 }
 /** Alec proves he saved the key by typing its last group. */
 async confirm(lastGroup:string):Promise<boolean>{
  const s=await this.#store.read();if(!s)return false;
  const want=recoveryText(Buffer.from(s.key,'hex')).split('-').at(-1)!;
  if(lastGroup.trim().toUpperCase()!==want)return false;
  await this.#store.save({...s,confirmed:true});return true;
 }
 async disable(){const s=await this.#store.read();if(s)await this.#store.save({...s,on:false});}
 /** Writes one encrypted copy to every reachable folder, keeping the newest 14 in each. */
 async run(files:Record<string,Buffer>,force=false):Promise<{written:string[];skipped:string[]}>{
  const s=await this.#store.read().catch(()=>null);if(!s?.on||!s.confirmed)return {written:[],skipped:[]};
  const st=await this.status();
  if(!force&&st.newest&&this.now().getTime()-Date.parse(st.newest)<20*3600000)return {written:[],skipped:[]};
  const at=this.now(),data=seal(Buffer.from(s.key,'hex'),{at:at.toISOString(),files}),name=`harmony-offsite-${stamp(at)}.hbk`;
  const written:string[]=[],skipped:string[]=[];
  for(const t of s.targets){
   try{
    if(!await reachable(t))throw new Error('missing');
    const dir=join(t,FOLDER);mkdirSync(dir,{recursive:true});
    const tmp=join(dir,`.${name}.tmp`);writeFileSync(tmp,data);renameSync(tmp,join(dir,name));
    for(const old of OffsiteBackups.list(dir).slice(KEEP))try{unlinkSync(join(dir,old.name));}catch{}
    written.push(t);
   }catch{skipped.push(t);}
  }
  this.#error=skipped.length&&!written.length?'None of the backup places could be reached.':skipped.length?`Couldn't reach ${skipped.join(', ')}.`:null;
  return {written,skipped};
 }
 /** Restore on this PC from a copy, with the recovery key (typed) or the stored one. Returns the files. */
 async restore(file:string,recovery:string|null):Promise<Payload>{
  if(!FILE.test(file.split(/[\\/]/).at(-1)??''))throw new Error('Pick a HARMONY off-PC backup (.hbk).');
  const key=recovery?parseRecovery(recovery):await this.#store.read().then(s=>s?Buffer.from(s.key,'hex'):null).catch(()=>null);
  if(!key)throw new WrongKey(recovery?'That doesn\'t look like a recovery key (13 groups of 4 letters and numbers).':'Enter the recovery key.');
  if(!existsSync(file))throw new Error('That backup file is missing.');
  return open(key,readFileSync(file));
 }
}
