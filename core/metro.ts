/** "When's my next bus?" (step 42): Madison Metro's live arrival predictions.
 *
 * Data: Metro Transit's public GTFS feeds (no key). The live feed (GTFS-realtime trip updates and alerts, protocol
 * buffers) is read on request; the stop, route and trip names come from the static GTFS zip, kept in data/metro and
 * refreshed weekly. Used under Metro's Developer License Agreement ("assisting mass transit riders"); the data is
 * the City of Madison's, given as is, and predictions can be wrong, which HARMONY says when there's nothing live.
 * Nothing about Alec is sent: the requests are plain downloads of the whole feed.
 * Pure parsing is exported for the tests; network and files are injected. */
import {inflateRawSync} from 'node:zlib';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const METRO_URLS={
 trips:'https://metromap.cityofmadison.com/gtfsrt/trips',
 alerts:'https://metromap.cityofmadison.com/gtfsrt/alerts',
 gtfs:'https://transitdata.cityofmadison.com/GTFS/mmt_gtfs.zip',
};
export const STATIC_MAX_AGE_MS=7*24*3600000;
const MAX_FEED=8*1024*1024,MAX_ZIP=60*1024*1024,MAX_FILE=40*1024*1024;

// ---- Protocol buffers (just the wire format; field numbers from the GTFS-realtime spec) ----
type Field={no:number;wire:number;num:number;start:number;end:number};
function varint(b:Uint8Array,p:number):[number,number]{
 let v=0,m=1,i=0;
 for(;;){if(p>=b.length||i>=10)throw new Error('Bad feed');const x=b[p++];v+=(x&0x7f)*m;m*=128;i++;if(!(x&0x80))break;}
 if(v>=2**63)v-=2**64; // negative int32/int64 (two's complement, ten bytes)
 return [v,p];
}
function* fields(b:Uint8Array,start=0,end=b.length):Generator<Field>{
 let p=start;
 while(p<end){
  const [key,p1]=varint(b,p);p=p1;const no=Math.floor(key/8),wire=key%8;
  if(wire===0){const [v,p2]=varint(b,p);p=p2;yield {no,wire,num:v,start:0,end:0};}
  else if(wire===2){const [len,p2]=varint(b,p);p=p2;if(len<0||p+len>end)throw new Error('Bad feed');yield {no,wire,num:0,start:p,end:p+len};p+=len;}
  else if(wire===1){p+=8;if(p>end)throw new Error('Bad feed');}
  else if(wire===5){p+=4;if(p>end)throw new Error('Bad feed');}
  else throw new Error('Bad feed');
 }
}
const text=(b:Uint8Array,f:Field)=>new TextDecoder().decode(b.subarray(f.start,f.end));
function translated(b:Uint8Array,f:Field):string{
 let best='',english='';
 for(const t of fields(b,f.start,f.end))if(t.no===1&&t.wire===2){
  let s='',lang='';for(const x of fields(b,t.start,t.end)){if(x.no===1&&x.wire===2)s=text(b,x);if(x.no===2&&x.wire===2)lang=text(b,x);}
  if(!best)best=s;if(/^en/i.test(lang))english=s;
 }
 return (english||best).replace(/\s+/g,' ').trim();
}

export interface Arrival {tripId:string;routeId:string;stopId:string;time:number;}
export interface MetroAlert {header:string;description:string;routes:string[];stops:string[];start:number|null;end:number|null;}

/** Every predicted arrival (or departure) at every stop in a GTFS-realtime TripUpdates feed. Skipped stops are left out. */
export function parseTripUpdates(b:Uint8Array):Arrival[]{
 const out:Arrival[]=[];
 for(const e of fields(b))if(e.no===2&&e.wire===2)for(const tu of fields(b,e.start,e.end))if(tu.no===3&&tu.wire===2){
  let tripId='',routeId='';const stops:{stopId:string;time:number;skipped:boolean}[]=[];
  for(const f of fields(b,tu.start,tu.end)){
   if(f.no===1&&f.wire===2)for(const d of fields(b,f.start,f.end)){if(d.no===1&&d.wire===2)tripId=text(b,d);if(d.no===5&&d.wire===2)routeId=text(b,d);}
   if(f.no===2&&f.wire===2){
    let stopId='',arrival=0,departure=0,skipped=false;
    for(const s of fields(b,f.start,f.end)){
     if(s.no===4&&s.wire===2)stopId=text(b,s);
     if(s.no===5&&s.wire===0&&s.num===1)skipped=true;
     if((s.no===2||s.no===3)&&s.wire===2)for(const ev of fields(b,s.start,s.end))if(ev.no===2&&ev.wire===0){if(s.no===2)arrival=ev.num;else departure=ev.num;}
    }
    const time=arrival||departure;if(stopId&&time>0)stops.push({stopId,time,skipped});
   }
  }
  for(const s of stops)if(!s.skipped)out.push({tripId,routeId,stopId:s.stopId,time:s.time});
 }
 return out;
}
/** The service alerts in a GTFS-realtime Alerts feed. */
export function parseAlerts(b:Uint8Array):MetroAlert[]{
 const out:MetroAlert[]=[];
 for(const e of fields(b))if(e.no===2&&e.wire===2)for(const a of fields(b,e.start,e.end))if(a.no===5&&a.wire===2){
  const alert:MetroAlert={header:'',description:'',routes:[],stops:[],start:null,end:null};
  for(const f of fields(b,a.start,a.end)){
   if(f.no===1&&f.wire===2)for(const t of fields(b,f.start,f.end)){if(t.no===1&&t.wire===0)alert.start=alert.start===null?t.num:Math.min(alert.start,t.num);if(t.no===2&&t.wire===0)alert.end=Math.max(alert.end??0,t.num);}
   if(f.no===5&&f.wire===2)for(const s of fields(b,f.start,f.end)){if(s.no===2&&s.wire===2)alert.routes.push(text(b,s));if(s.no===5&&s.wire===2)alert.stops.push(text(b,s));}
   if(f.no===10&&f.wire===2)alert.header=translated(b,f);
   if(f.no===11&&f.wire===2)alert.description=translated(b,f);
  }
  if(alert.header||alert.description)out.push(alert);
 }
 return out;
}

// ---- The static GTFS zip (only three small files are read out of it) ----
/** Reads named files from a zip (stored or deflated; no zip64), each capped in size. */
export function unzip(zip:Uint8Array,want:readonly string[]):Record<string,string>{
 const dv=new DataView(zip.buffer,zip.byteOffset,zip.byteLength),out:Record<string,string>={};
 let eocd=-1;for(let i=zip.length-22;i>=Math.max(0,zip.length-22-65535);i--)if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw new Error('Not a zip file');
 const count=dv.getUint16(eocd+10,true);let p=dv.getUint32(eocd+16,true);
 for(let n=0;n<count;n++){
  if(p+46>zip.length||dv.getUint32(p,true)!==0x02014b50)throw new Error('Bad zip directory');
  const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),usize=dv.getUint32(p+24,true),nlen=dv.getUint16(p+28,true),xlen=dv.getUint16(p+30,true),clen=dv.getUint16(p+32,true),local=dv.getUint32(p+42,true);
  const name=new TextDecoder().decode(zip.subarray(p+46,p+46+nlen)).replace(/^.*\//,'');
  p+=46+nlen+xlen+clen;
  if(!want.includes(name)||usize>MAX_FILE)continue;
  if(dv.getUint32(local,true)!==0x04034b50)throw new Error('Bad zip entry');
  const start=local+30+dv.getUint16(local+26,true)+dv.getUint16(local+28,true),data=zip.subarray(start,start+csize);
  const raw=method===0?data:method===8?inflateRawSync(data,{maxOutputLength:MAX_FILE}):null;
  if(raw)out[name]=new TextDecoder().decode(raw);
 }
 return out;
}
/** RFC 4180 CSV (GTFS text files) as objects keyed by the header row. */
export function csv(textIn:string):Record<string,string>[]{
 const rows:string[][]=[];let row:string[]=[],cell='',q=false;const t=textIn.replace(/^﻿/,'');
 for(let i=0;i<t.length;i++){
  const c=t[i];
  if(q){if(c==='"'){if(t[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=c;continue;}
  if(c==='"')q=true;else if(c===','){row.push(cell);cell='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&t[i+1]==='\n')i++;row.push(cell);cell='';if(row.length>1||row[0]!=='')rows.push(row);row=[];}
  else cell+=c;
 }
 if(cell!==''||row.length){row.push(cell);rows.push(row);}
 const head=(rows.shift()??[]).map(h=>h.trim());
 return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,(r[i]??'').trim()])));
}

export interface MetroStatic {fetched:string;stops:[id:string,name:string,code:string][];routes:Record<string,[short:string,long:string]>;trips:Record<string,[routeId:string,headsign:string]>;}
export function buildStatic(files:Record<string,string>,fetched:string):MetroStatic{
 if(!files['stops.txt']||!files['routes.txt']||!files['trips.txt'])throw new Error('The Metro schedule file is missing parts');
 const stops=csv(files['stops.txt']).filter(s=>s.stop_id&&s.stop_name&&(s.location_type??'0')!=='1').map(s=>[s.stop_id,s.stop_name,s.stop_code??''] as [string,string,string]);
 const routes:MetroStatic['routes']={};for(const r of csv(files['routes.txt']))if(r.route_id)routes[r.route_id]=[r.route_short_name||r.route_id,r.route_long_name??''];
 const trips:MetroStatic['trips']={};for(const t of csv(files['trips.txt']))if(t.trip_id)trips[t.trip_id]=[t.route_id??'',t.trip_headsign??''];
 return {fetched,stops,routes,trips};
}

// ---- Finding a stop from spoken words ----
const ABBR:Record<string,string>={st:'street',ave:'avenue',av:'avenue',blvd:'boulevard',dr:'drive',rd:'road',ln:'lane',pkwy:'parkway',hwy:'highway',ct:'court',pl:'place',
 n:'north',s:'south',e:'east',w:'west',tp:'transfer',sb:'southbound',nb:'northbound',eb:'eastbound',wb:'westbound',univ:'university',mt:'mount',ctr:'center'};
const SKIP=new Set(['and','at','the','of','on','stop','bus','street','avenue','road','drive','boulevard','lane','by','near','corner','in','station','&']);
export function stopWords(name:string):string[]{
 return name.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim().split(' ').map(w=>ABBR[w]??w).filter(w=>w&&!SKIP.has(w));
}
/** The stops whose names contain every word said (in any order: "Johnson and Few" finds "E Johnson & N Few"), or the
 * stop with that number from the sign. Both directions of a corner are usually separate stops; all are returned. */
export function findStops(st:MetroStatic,spoken:string):{ids:string[];name:string}|null{
 const code=spoken.match(/\b(?:stop|number|#)\s*#?\s*([a-z]?\d{3,4})\b/i)?.[1]??(/^\s*[a-z]?\d{3,4}\s*$/i.test(spoken)?spoken.trim():null);
 if(code){const c=code.toUpperCase(),s=st.stops.filter(x=>x[2].toUpperCase()===c||x[2]===c.padStart(4,'0'));if(s.length)return {ids:s.map(x=>x[0]),name:s[0][1]};}
 const want=stopWords(spoken);if(!want.length)return null;
 const hits=st.stops.filter(s=>{const have=stopWords(s[1]);return want.every(w=>have.some(h=>h===w||(w.length>=4&&h.startsWith(w))||(h.length>=4&&w.startsWith(h))));});
 if(!hits.length)return null;
 // Prefer the tightest names (fewest extra words), so "Capitol Square" doesn't pull in every stop that mentions it.
 const extra=(s:[string,string,string])=>stopWords(s[1]).length-want.length,least=Math.min(...hits.map(extra));
 const best=hits.filter(s=>extra(s)===least).slice(0,8);
 return {ids:best.map(s=>s[0]),name:best[0][1]};
}

/** "2-AMERICAN CENTER" → "American Center", "FITCHBURG/CADDIS" → "Fitchburg and Caddis", for speaking. */
export function headsignText(v:string):string{
 return v.replace(/^\s*\d+\s*-\s*/,'').replace(/\bU\.W\./gi,'UW').replace(/\s*\/\s*/g,' and ').toLowerCase()
  .replace(/\b([a-z])([a-z']*)/g,(w,a:string,b:string)=>['via','and','of','the'].includes(w)?w:w==='uw'?'UW':a.toUpperCase()+b).replace(/\s+/g,' ').trim();
}
const NUMBER_WORDS:Record<string,string>={one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10',eleven:'11',twelve:'12',thirteen:'13',fourteen:'14',fifteen:'15',sixteen:'16',seventeen:'17',eighteen:'18',nineteen:'19',twenty:'20',thirty:'30',forty:'40',fifty:'50',eighty:'80'};
export const routeName=(v:string)=>{const w=v.trim().toLowerCase().replace(/^(route|number|the)\s+/,'').replace(/\s+bus$/,'');return NUMBER_WORDS[w]??w.toUpperCase();};

/** The spoken answer: the next arrivals per route and direction, soonest first, and alerts that touch them. */
export function arrivalsText(st:MetroStatic,arrivals:readonly Arrival[],alerts:readonly MetroAlert[],stop:{ids:string[];name:string},route:string,nowMs:number):string{
 const now=nowMs/1000,ids=new Set(stop.ids),want=route?routeName(route):'';
 const groups=new Map<string,{route:string;headsign:string;times:number[]}>();
 for(const a of arrivals){
  if(!ids.has(a.stopId)||a.time<now-30||a.time>now+90*60)continue;
  const trip=st.trips[a.tripId],routeId=a.routeId||trip?.[0]||'',short=st.routes[routeId]?.[0]??routeId;
  if(want&&short.toUpperCase()!==want)continue;
  const key=`${short}|${trip?.[1]??''}`,g=groups.get(key)??{route:short,headsign:trip?.[1]??'',times:[]};g.times.push(a.time);groups.set(key,g);
 }
 const mins=(t:number)=>{const m=Math.round((t-now)/60);return m<=0?'arriving now':m===1?'in 1 minute':`in ${m} minutes`;};
 const parts=[...groups.values()].map(g=>({...g,times:[...new Set(g.times)].sort((a,b)=>a-b)})).sort((a,b)=>a.times[0]-b.times[0]).slice(0,4)
  .map(g=>{const later=g.times.slice(1,3).map(t=>Math.max(0,Math.round((t-now)/60)));
   return `the ${g.route}${g.headsign?` to ${headsignText(g.headsign)}`:''} ${mins(g.times[0])}${later.length?`, then ${later.join(' and ')} minutes`:''}`;});
 const place=stop.name.replace(/\s*&\s*/g,' and ');
 const head=parts.length?`At ${place}: ${parts.join('; ')}.`
  :`No live arrivals at ${place}${want?` for the ${want}`:''} in the next 90 minutes. The bus may not be tracked right now, so check the schedule to be sure.`;
 const routeIds=new Set([...groups.values()].map(g=>Object.entries(st.routes).find(([,v])=>v[0]===g.route)?.[0]).filter(Boolean) as string[]);
 const relevant=alerts.filter(a=>(a.start===null||a.start<=now)&&(a.end===null||a.end===0||a.end>=now)&&(a.stops.some(s=>ids.has(s))||a.routes.some(r=>routeIds.has(r)))).slice(0,2);
 const notes=relevant.map(a=>a.header||a.description.slice(0,160));
 return notes.length?`${head} Metro alert: ${notes.join('. ')}`.slice(0,700):head;
}

export class MetroError extends Error {}
type Fetch=typeof fetch;
export class MadisonMetro {
 #static:MetroStatic|null=null;#loading:Promise<MetroStatic>|null=null;
 private dir:string;private fetcher:Fetch;private now:()=>number;
 constructor(dir:string,fetcher:Fetch=fetch,now:()=>number=Date.now){this.dir=dir;this.fetcher=fetcher;this.now=now;}
 #settingsPath(){return join(this.dir,'settings.json');}
 /** The stop Alec calls "my stop" (what he said, not an id: matched against the schedule each time). */
 savedStop():string|null{try{const v=JSON.parse(readFileSync(this.#settingsPath(),'utf8'));return typeof v.stop==='string'&&v.stop.length<=80?v.stop:null;}catch{return null;}}
 async saveStop(spoken:string,signal:AbortSignal):Promise<string>{
  const st=await this.#schedule(signal),s=findStops(st,spoken);
  if(!s)throw new MetroError(`I couldn't find a Metro stop called ${spoken.slice(0,60)}. Try the street names, or the stop number on the sign.`);
  mkdirSync(this.dir,{recursive:true});writeFileSync(this.#settingsPath(),JSON.stringify({stop:spoken.slice(0,80)}));
  return s.name.replace(/\s*&\s*/g,' and ');
 }
 async #get(url:string,max:number,signal:AbortSignal):Promise<Uint8Array>{
  const timeout=AbortSignal.timeout(20000);let res:Response;
  try{res=await this.fetcher(url,{signal:AbortSignal.any([signal,timeout]),redirect:'follow',headers:{'User-Agent':'HARMONY (personal assistant; Madison Metro rider)'}});}
  catch{signal.throwIfAborted();throw new MetroError(timeout.aborted?'Metro\'s feed timed out.':'I couldn\'t reach Metro\'s feed.');}
  if(!res.ok)throw new MetroError(`Metro's feed answered ${res.status}.`);
  const reader=res.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw new MetroError('Metro\'s feed was larger than expected.');}chunks.push(value);}
  return new Uint8Array(Buffer.concat(chunks));
 }
 async #schedule(signal:AbortSignal):Promise<MetroStatic>{
  const fresh=(s:MetroStatic|null)=>!!s&&this.now()-Date.parse(s.fetched)<STATIC_MAX_AGE_MS;
  if(fresh(this.#static))return this.#static!;
  const file=join(this.dir,'schedule.json');
  if(!this.#static&&existsSync(file)){try{this.#static=JSON.parse(readFileSync(file,'utf8')) as MetroStatic;}catch{}}
  if(fresh(this.#static))return this.#static!;
  if(!this.#loading)this.#loading=(async()=>{
   try{
    const st=buildStatic(unzip(await this.#get(METRO_URLS.gtfs,MAX_ZIP,signal),['stops.txt','routes.txt','trips.txt']),new Date(this.now()).toISOString());
    mkdirSync(this.dir,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify(st));renameSync(file+'.tmp',file);
    this.#static=st;return st;
   }catch(e){if(this.#static)return this.#static;throw e;} // a stale copy beats none
   finally{this.#loading=null;}
  })();
  return this.#loading;
 }
 /** "When's the next bus at <stop>" (stop '' = Alec's saved stop; route optional). */
 async next(stop:string,route:string,signal:AbortSignal):Promise<string>{
  const spoken=stop.trim()||this.savedStop();
  if(!spoken)throw new MetroError('Which stop? Say it like: next bus at Johnson and Few. You can also say: my bus stop is, and the stop.');
  const st=await this.#schedule(signal),s=findStops(st,spoken);
  if(!s)throw new MetroError(`I couldn't find a Metro stop called ${spoken.slice(0,60)}. Try the street names, or the stop number on the sign.`);
  const [trips,alerts]=await Promise.all([this.#get(METRO_URLS.trips,MAX_FEED,signal),this.#get(METRO_URLS.alerts,MAX_FEED,signal).catch(()=>new Uint8Array())]);
  let al:MetroAlert[]=[];try{al=parseAlerts(alerts);}catch{}
  return arrivalsText(st,parseTripUpdates(trips),al,s,route,this.now());
 }
}

/** Spoken bus questions, matched without the brain (so they don't add to every prompt). Returns stop, route and
 * whether it's "my bus stop is ...". */
export function busIntent(said:string):{action:'times'|'save';stop:string;route:string}|null{
 const t=said.trim().toLowerCase().replace(/[?.!]+$/,'').replace(/^(hey |ok |okay )?(harmony[,.!]?\s*)?/,'').trim();
 let m=t.match(/^(?:set |save )?my (?:bus )?stop (?:is|to) (.{2,80})$/);if(m)return {action:'save',stop:m[1],route:''};
 const R='(?:the )?(?:number |route |rapid )?(\\d{1,2}|[a-hj-z]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|eighty)';
 const AT='(?:\\s+(?:at|from|to|for|on|near)\\s+(?:the\\s+)?(.{2,80}?)(?:\\s+stop)?)?';
 m=t.match(new RegExp(`^(?:when'?s|when is|what time is|where'?s|where is) (?:the |my )?next ${R}? ?bus(?:es)?${AT}$`));if(m)return {action:'times',stop:m[2]??'',route:m[1]??''};
 m=t.match(new RegExp(`^(?:when'?s|when is|where'?s|where is) my bus${AT}$`));if(m)return {action:'times',stop:m[1]??'',route:''};
 m=t.match(new RegExp(`^(?:next|upcoming) ${R}? ?bus(?:es)?${AT}$`));if(m)return {action:'times',stop:m[2]??'',route:m[1]??''};
 m=t.match(new RegExp(`^bus (?:times|arrivals)${AT}$`));if(m)return {action:'times',stop:m[1]??'',route:''};
 m=t.match(new RegExp(`^when (?:does|will|is) ${R}(?: bus)? (?:come|coming|get here|arrive|arriving|due|leave|leaving)${AT}$`));if(m)return {action:'times',stop:m[2]??'',route:m[1]};
 m=t.match(new RegExp(`^is ${R}(?: bus)? (?:late|on time|running|coming)${AT}$`));if(m)return {action:'times',stop:m[2]??'',route:m[1]};
 return null;
}
