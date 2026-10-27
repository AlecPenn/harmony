/** World feeds: the free, key-less public sources from God's Eye v9, ported to HARMONY (parsing follows v9's
 * server.py). Each feed becomes the same shape, a WorldEvent, so HARMONY can answer, watch areas, brief you in the
 * morning and pin events on the God's Eye globe. Read-only public data; nothing about you is sent anywhere.
 *
 *  volcano   USGS HANS currently elevated US volcanoes        disaster  GDACS 7-day global alerts (EQ, TC, FL, VO, DR, WF)
 *  alert     NWS severe and extreme US alerts (incl. tsunami, flood, tornado)   natural  NASA EONET open natural events
 *  space     NOAA SWPC Kp index and X-ray flares              aurora    NOAA SWPC OVATION aurora chance at a place
 *  outage    IODA internet outage alerts                      fireball  NASA/JPL CNEOS fireballs
 *  asteroid  NASA NeoWs close approaches today (DEMO_KEY unless a NASA key is in the vault)
 *  airport   FAA NAS status: US airport delays, ground stops, closures   cyber  CISA actively exploited vulnerabilities
 *  hurricane NOAA NHC/CPHC active tropical storms (Atlantic, east and central Pacific)
 *  wildfire  NIFC WFIGS current US wildfires (size, containment)    river  NOAA NWPS river gauges at flood stage (near a place)
 *  quake     USGS plus EMSC (Europe's seismic centre, worldwide and quick), merged without duplicates
 */
export type FeedKind='volcano'|'disaster'|'alert'|'natural'|'space'|'aurora'|'outage'|'fireball'|'asteroid'|'quake'|'airport'|'cyber'|'hurricane'|'wildfire'|'river';
export interface WorldEvent {id:string;kind:FeedKind;title:string;detail:string;lat:number|null;lon:number|null;at:string|null;severity:number;source:string;url:string|null;}
export interface Near {lat:number;lon:number;radiusKm:number;name?:string;}
type Fetch=typeof fetch;
const UA='HARMONY/1 (personal assistant; God\'s Eye feeds)';
const num=(v:unknown)=>{const n=typeof v==='number'?v:typeof v==='string'?parseFloat(v):NaN;return Number.isFinite(n)?n:null;};
const clean=(s:unknown,n=200)=>typeof s==='string'?s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n):'';
const iso=(v:unknown)=>{if(typeof v!=='string'&&typeof v!=='number')return null;const d=new Date(typeof v==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(v)?v.replace(' ','T')+'Z':v);return Number.isFinite(d.getTime())?d.toISOString():null;};
const valid=(lat:number|null,lon:number|null)=>lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0);
export function distanceKm(aLat:number,aLon:number,bLat:number,bLon:number){
 const r=Math.PI/180,dLat=(bLat-aLat)*r,dLon=(bLon-aLon)*r,h=Math.sin(dLat/2)**2+Math.cos(aLat*r)*Math.cos(bLat*r)*Math.sin(dLon/2)**2;
 return 2*6371*Math.asin(Math.min(1,Math.sqrt(h)));
}

// ---- parsers (pure; tested with fixtures shaped like each feed) ----------------------------------------------
export function parseHans(data:unknown):WorldEvent[]{
 if(!Array.isArray(data))return [];
 const level:Record<string,number>={WARNING:1,RED:1,WATCH:.75,ORANGE:.75,ADVISORY:.5,YELLOW:.5};
 // HANS "getCapElevated" (current) uses snake_case; v9's older endpoint used camelCase. Both are read.
 return data.flatMap((n,i)=>{
  if(!n||typeof n!=='object')return [];const o=n as Record<string,unknown>;
  const lat=num(o.latitude),lon=num(o.longitude);if(!valid(lat,lon))return [];
  const name=clean(o.volcano_name_appended??o.volcano_name??o.volcanoName??o.title,80).replace(/ Volcano$/,'');
  const alert=clean(o.alert_level??o.alertLevel??o.colorCode??'',20).toUpperCase(),color=clean(o.color_code??o.colorCode??'',20).toUpperCase();
  const url=o.notice_url??o.noticeUrl;
  return [{id:`volcano:${clean(o.vnum,20)||name||i}`,kind:'volcano' as const,title:`${name||'Volcano'}: ${alert||'elevated'}${color&&color!==alert?` (aviation ${color.toLowerCase()})`:''}`,
   detail:clean(o.synopsis??o.noticeSynopsis??'',240),lat,lon,at:iso(o.sent_date_cap??o.pubDate??o.sentUtc??o.noticeDate??o.date),severity:Math.max(level[alert]??.4,level[color]??0),
   source:clean(o.obs_fullname,60)||'USGS Volcano Hazards',url:typeof url==='string'?url:null}];
 });
}
export function parseQuakes(data:unknown):WorldEvent[]{
 const f=(data as {features?:unknown[]})?.features;if(!Array.isArray(f))return [];
 return f.slice(0,500).flatMap(x=>{
  const o=x as {id?:string;properties?:{mag?:number;place?:string;time?:number;url?:string;tsunami?:number};geometry?:{coordinates?:number[]}};
  const mag=num(o.properties?.mag),c=o.geometry?.coordinates??[];const lat=num(c[1]),lon=num(c[0]);if(mag===null||!valid(lat,lon))return [];
  return [{id:`quake:${clean(o.id,40)}`,kind:'quake' as const,title:`Magnitude ${mag.toFixed(1)} earthquake ${clean(o.properties?.place,120)}`,detail:o.properties?.tsunami?'The tsunami flag is set: check official tsunami alerts.':'',
   lat,lon,at:typeof o.properties?.time==='number'?new Date(o.properties.time).toISOString():null,severity:mag>=6?1:mag>=5?.75:mag>=4?.5:.3,source:'USGS',url:typeof o.properties?.url==='string'?o.properties.url:null}];
 });
}
export function parseGdacs(xml:string):WorldEvent[]{
 const types:Record<string,string>={EQ:'Earthquake',TC:'Tropical cyclone',FL:'Flood',VO:'Volcano',DR:'Drought',WF:'Wildfire',TS:'Tsunami'};
 const tag=(item:string,name:string)=>{const m=item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));return m?m[1].replace(/^<!\[CDATA\[|\]\]>$/g,''):'';};
 return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,200).flatMap(([,item])=>{
  const pt=tag(item,'georss:point').trim().split(/\s+/).map(Number);const lat=num(pt[0]),lon=num(pt[1]);if(!valid(lat,lon))return [];
  const type=clean(tag(item,'gdacs:eventtype'),4).toUpperCase(),alert=clean(tag(item,'gdacs:alertlevel'),10).toLowerCase();
  const id=clean(tag(item,'gdacs:eventid'),20)||clean(tag(item,'guid'),80);
  return [{id:`gdacs:${type}:${id}`,kind:'disaster' as const,title:clean(tag(item,'title'),160)||`${types[type]??'Disaster'} alert`,detail:clean(tag(item,'description'),280),lat,lon,
   at:iso(clean(tag(item,'pubDate'),60)),severity:alert==='red'?1:alert==='orange'?.7:.35,source:`GDACS ${types[type]??type}`,url:clean(tag(item,'link'),300)||null}];
 });
}
function centroid(geometry:unknown):[number,number]|null{
 if(!geometry||typeof geometry!=='object')return null;const g=geometry as {type?:string;coordinates?:unknown};
 const pts:number[][]=[];const walk=(c:unknown)=>{if(Array.isArray(c)&&typeof c[0]==='number'&&typeof c[1]==='number')pts.push(c as number[]);else if(Array.isArray(c))c.forEach(walk);};walk(g.coordinates);
 if(!pts.length)return null;const lon=pts.reduce((s,p)=>s+p[0],0)/pts.length,lat=pts.reduce((s,p)=>s+p[1],0)/pts.length;return [lat,lon];
}
export function parseNws(data:unknown):WorldEvent[]{
 const f=(data as {features?:unknown[]})?.features;if(!Array.isArray(f))return [];
 const sev:Record<string,number>={Extreme:1,Severe:.75,Moderate:.45,Minor:.2};
 return f.slice(0,400).flatMap((x,i)=>{
  const p=(x as {properties?:Record<string,unknown>}).properties??{};const c=centroid((x as {geometry?:unknown}).geometry);
  const event=clean(p.event,60);if(!event)return [];
  return [{id:`nws:${clean(p.id,120)||i}`,kind:'alert' as const,title:`${event}: ${clean(p.areaDesc,120)}`,detail:clean(p.headline,240),lat:c?.[0]??null,lon:c?.[1]??null,
   at:iso(p.effective??p.sent),severity:/tsunami warning|tornado warning|extreme wind/i.test(event)?1:sev[String(p.severity)]??.3,source:'US National Weather Service',url:typeof p['@id']==='string'?p['@id']:null}];
 });
}
export function parseEonet(data:unknown):WorldEvent[]{
 const ev=(data as {events?:unknown[]})?.events;if(!Array.isArray(ev))return [];
 return ev.slice(0,100).flatMap(x=>{
  const o=x as {id?:string;title?:string;categories?:{title?:string}[];geometry?:{date?:string;coordinates?:unknown}[];sources?:{url?:string}[]};
  const last=Array.isArray(o.geometry)?o.geometry.at(-1):undefined;const c=last?centroid({coordinates:last.coordinates}):null;if(!c||!valid(c[0],c[1]))return [];
  const cat=clean(o.categories?.[0]?.title,40);
  return [{id:`eonet:${clean(o.id,40)}`,kind:'natural' as const,title:clean(o.title,160),detail:cat,lat:c[0],lon:c[1],at:iso(last?.date),severity:/volcano|severe storm/i.test(cat)?.6:.4,source:'NASA EONET',url:o.sources?.[0]?.url??null}];
 });
}
/** Kp (planetary geomagnetic) index: old array-of-arrays or newer array-of-objects. */
export function parseKp(data:unknown):{kp:number;at:string|null}|null{
 if(!Array.isArray(data)||!data.length)return null;
 const last=data.at(-1);
 if(Array.isArray(last)){const h=data[0] as string[];const i=h.indexOf('Kp'),t=h.indexOf('time_tag');const kp=num(last[i>=0?i:1]);return kp===null?null:{kp,at:iso(last[t>=0?t:0])};}
 if(last&&typeof last==='object'){const o=last as Record<string,unknown>;const kp=num(o.Kp??o.kp_index??o.kp);return kp===null?null:{kp,at:iso(o.time_tag)};}
 return null;
}
export const flareClass=(flux:number)=>{const [c,b]=flux>=1e-4?['X',1e-4]:flux>=1e-5?['M',1e-5]:flux>=1e-6?['C',1e-6]:flux>=1e-7?['B',1e-7]:['A',1e-8];return `${c}${(flux/b).toFixed(1)}`;};
export function parseXray(data:unknown):{peak:number;cls:string;at:string|null}|null{
 if(!Array.isArray(data))return null;let peak=0,at:string|null=null;
 for(const r of data){const o=r as Record<string,unknown>;if(o.energy!=='0.1-0.8nm')continue;const f=num(o.flux);if(f!==null&&f>peak){peak=f;at=iso(o.time_tag);}}
 return peak>0?{peak,cls:flareClass(peak),at}:null;
}
/** OVATION: [lon 0..359, lat, chance%]. The chance at the nearest grid point to a place. */
export function auroraChance(data:unknown,lat:number,lon:number):number|null{
 const c=(data as {coordinates?:unknown[]})?.coordinates;if(!Array.isArray(c))return null;
 const L=((Math.round(lon)%360)+360)%360,A=Math.round(lat);let best:number|null=null;
 for(const p of c){if(Array.isArray(p)&&p[0]===L&&p[1]===A){best=num(p[2]);break;}}
 return best;
}
export function parseIoda(data:unknown):WorldEvent[]{
 const d=(data as {data?:unknown[]})?.data;if(!Array.isArray(d))return [];
 const seen=new Map<string,WorldEvent>();
 for(const x of d.slice(0,2000)){
  const o=x as {entity?:{name?:string;type?:string;code?:string};time?:number;level?:string;datasource?:string};
  if(o.level!=='critical'&&o.level!=='warning')continue;const name=clean(o.entity?.name,80);if(!name)continue;
  const key=`${o.entity?.type}:${o.entity?.code}`;const prev=seen.get(key);
  const ev:WorldEvent={id:`ioda:${key}`,kind:'outage',title:`Internet outage signal: ${name}${o.entity?.type&&o.entity.type!=='country'?` (${o.entity.type})`:''}`,detail:`${o.level} on ${clean(o.datasource,20)}`,lat:null,lon:null,
   at:typeof o.time==='number'?new Date(o.time*1000).toISOString():null,severity:o.level==='critical'?.8:.5,source:'IODA (Georgia Tech)',url:'https://ioda.inetintel.cc.gatech.edu/'};
  if(!prev||(ev.at??'')>(prev.at??''))seen.set(key,ev);
 }
 return [...seen.values()];
}
export function parseFireballs(data:unknown):WorldEvent[]{
 const o=data as {fields?:string[];data?:unknown[][]};if(!Array.isArray(o?.fields)||!Array.isArray(o?.data))return [];
 return o.data.slice(0,100).flatMap(row=>{
  const r=Object.fromEntries(o.fields!.map((f,i)=>[f,row[i]]));
  let lat=num(r.lat),lon=num(r.lon);if(lat!==null&&r['lat-dir']==='S')lat=-lat;if(lon!==null&&r['lon-dir']==='W')lon=-lon;if(!valid(lat,lon))return [];
  const kt=num(r['impact-e']);
  return [{id:`fireball:${r.date}`,kind:'fireball' as const,title:`Fireball${kt?` (${kt} kt)`:''}`,detail:`Detected by US government sensors${num(r.alt)?` at ${r.alt} km altitude`:''}.`,lat,lon,at:iso(r.date),severity:kt&&kt>=1?.6:.25,source:'NASA/JPL CNEOS',url:'https://cneos.jpl.nasa.gov/fireballs/'}];
 });
}
export function parseNeo(data:unknown):WorldEvent[]{
 const n=(data as {near_earth_objects?:Record<string,unknown[]>})?.near_earth_objects;if(!n||typeof n!=='object')return [];
 return Object.values(n).flat().slice(0,100).flatMap(x=>{
  const o=x as {id?:string;name?:string;is_potentially_hazardous_asteroid?:boolean;nasa_jpl_url?:string;estimated_diameter?:{meters?:{estimated_diameter_max?:number}};close_approach_data?:{close_approach_date_full?:string;miss_distance?:{lunar?:string};relative_velocity?:{kilometers_per_hour?:string}}[]};
  const ca=o.close_approach_data?.[0];const lunar=num(ca?.miss_distance?.lunar);const d=num(o.estimated_diameter?.meters?.estimated_diameter_max);
  return [{id:`neo:${clean(o.id,20)}`,kind:'asteroid' as const,title:`Asteroid ${clean(o.name,40)} passes ${lunar!==null?`${lunar.toFixed(1)} times the Moon's distance`:'by'}`,
   detail:`${d?`About ${Math.round(d)} m across. `:''}${o.is_potentially_hazardous_asteroid?'Classed as potentially hazardous (a size/orbit label, not a threat today).':'Not classed as potentially hazardous.'}`,
   lat:null,lon:null,at:iso(ca?.close_approach_date_full),severity:o.is_potentially_hazardous_asteroid&&lunar!==null&&lunar<5?.5:.15,source:'NASA NeoWs',url:o.nasa_jpl_url??null}];
 });
}

/** Where the busiest US airports are (and Madison's and Milwaukee's), so FAA programs can be pinned on the globe. */
export const AIRPORTS:Record<string,[number,number]>={ATL:[33.64,-84.43],ORD:[41.98,-87.9],MDW:[41.79,-87.75],DFW:[32.9,-97.04],DEN:[39.86,-104.67],LAX:[33.94,-118.41],
 SFO:[37.62,-122.38],SEA:[47.45,-122.31],JFK:[40.64,-73.78],LGA:[40.78,-73.87],EWR:[40.69,-74.17],BOS:[42.37,-71.01],PHL:[39.87,-75.24],IAD:[38.95,-77.46],
 DCA:[38.85,-77.04],BWI:[39.18,-76.67],CLT:[35.21,-80.94],MIA:[25.8,-80.29],MCO:[28.43,-81.31],FLL:[26.07,-80.15],TPA:[27.98,-82.53],IAH:[29.99,-95.34],
 HOU:[29.65,-95.28],PHX:[33.43,-112.01],LAS:[36.08,-115.15],SAN:[32.73,-117.19],SLC:[40.79,-111.98],DTW:[42.21,-83.35],MSP:[44.88,-93.22],STL:[38.75,-90.37],
 MCI:[39.3,-94.71],BNA:[36.13,-86.67],AUS:[30.2,-97.67],SAT:[29.53,-98.47],PDX:[45.59,-122.6],HNL:[21.32,-157.92],ANC:[61.17,-149.99],MSN:[43.14,-89.34],
 MKE:[42.95,-87.9],CLE:[41.41,-81.85],PIT:[40.49,-80.23],CVG:[39.05,-84.66],IND:[39.72,-86.29],CMH:[39.99,-82.89],RDU:[35.88,-78.79],SJC:[37.36,-121.93],
 OAK:[37.72,-122.22],SMF:[38.7,-121.59],SNA:[33.68,-117.87],DAL:[32.85,-96.85],MSY:[29.99,-90.26],TEB:[40.85,-74.06],HPN:[41.07,-73.71]};
/** FAA NAS status (XML). Read loosely by block, so small changes in the wrapper don't break it. */
export function parseFaa(xml:string):WorldEvent[]{
 const tag=(b:string,t:string)=>clean(b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`,'i'))?.[1]??'',160);
 const blocks=(t:string)=>[...xml.slice(0,2_000_000).matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`,'gi'))].map(m=>m[1]).slice(0,80);
 const ev=(arpt:string,what:string,detail:string,severity:number,i:number):WorldEvent[]=>{
  const code=arpt.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);if(!code)return [];const at=AIRPORTS[code];
  return [{id:`faa:${what}:${code}:${i}`,kind:'airport',title:`${code}: ${what}`,detail,lat:at?.[0]??null,lon:at?.[1]??null,at:null,severity,source:'FAA NAS Status',url:'https://nasstatus.faa.gov/'}];
 };
 const hours=(t:string)=>{const h=Number(t.match(/(\d+)\s*hour/)?.[1]??0),m=Number(t.match(/(\d+)\s*min/)?.[1]??0);return h+m/60;};
 return [
  ...blocks('Ground_Delay').flatMap((b,i)=>{const max=tag(b,'Max');return ev(tag(b,'ARPT'),'ground delay program',`${tag(b,'Reason')}${tag(b,'Avg')?`; average ${tag(b,'Avg')}`:''}${max?`, up to ${max}`:''}`,hours(max)>=2?.6:.45,i);}),
  ...blocks('Program').flatMap((b,i)=>ev(tag(b,'ARPT'),'ground stop',`${tag(b,'Reason')}${tag(b,'End_Time')?`; until ${tag(b,'End_Time')}`:''}`,.75,i)),
  ...blocks('Delay').flatMap((b,i)=>{const t=b.match(/<Arrival_Departure[^>]*Type="([^"]+)"/i)?.[1]??'';return ev(tag(b,'ARPT'),`${t?t.toLowerCase()+' ':''}delays`,`${tag(b,'Reason')}${tag(b,'Min')?`; ${tag(b,'Min')} to ${tag(b,'Max')}${tag(b,'Trend')?`, ${tag(b,'Trend').toLowerCase()}`:''}`:''}`,.35,i);}),
  ...blocks('Airport').flatMap((b,i)=>ev(tag(b,'ARPT'),'closed',`${tag(b,'Reason').replace(/^!\S+\s*/,'')}${tag(b,'Reopen')?`; reopens ${tag(b,'Reopen')}`:''}`,.8,i)),
 ];
}
/** Software HARMONY or Alec's PC runs: a match makes a vulnerability worth saying first. */
const MINE=/\b(electron|node\.?js|python|chrom(e|ium)|windows|microsoft edge|github|git\b|npm|onnx|openssl|7-?zip|nvidia)\b/i;
/** CISA Known Exploited Vulnerabilities: what attackers are using right now (added in the last two weeks). */
export function parseKev(data:unknown,now:number):WorldEvent[]{
 const list=(data as {vulnerabilities?:unknown})?.vulnerabilities;if(!Array.isArray(list))return [];
 return list.flatMap((v:Record<string,unknown>)=>{
  const added=Date.parse(String(v.dateAdded??''));if(!Number.isFinite(added)||now-added>14*86400000)return [];
  const what=`${clean(v.vendorProject,60)} ${clean(v.product,60)}`.trim(),mine=MINE.test(`${v.vendorProject} ${v.product}`),ransom=String(v.knownRansomwareCampaignUse).toLowerCase()==='known';
  return [{id:`kev:${clean(v.cveID,30)}`,kind:'cyber' as const,title:`${clean(v.cveID,30)}: ${what} being exploited${mine?' (software you use)':''}`,
   detail:`${clean(v.shortDescription,200)}${ransom?' Used by ransomware.':''}${clean(v.requiredAction,120)?` Fix: ${clean(v.requiredAction,120)}`:''}`,
   lat:null,lon:null,at:new Date(added).toISOString(),severity:mine?.9:ransom?.6:.45,source:'CISA KEV',url:`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(clean(v.cveID,30))}`}];
 }).sort((a,b)=>b.severity-a.severity||String(b.at).localeCompare(String(a.at))).slice(0,15);
}

/** NOAA NHC/CPHC CurrentStorms.json. intensity is in knots (as God's Eye View reads it). */
const STORM:Record<string,string>={TD:'Tropical Depression',STD:'Subtropical Depression',TS:'Tropical Storm',STS:'Subtropical Storm',HU:'Hurricane',PTC:'Potential Tropical Cyclone',PC:'Post-tropical Cyclone',TY:'Typhoon'};
const COMPASS=['north','north-northeast','northeast','east-northeast','east','east-southeast','southeast','south-southeast','south','south-southwest','southwest','west-southwest','west','west-northwest','northwest','north-northwest'];
export function parseNhc(data:unknown):WorldEvent[]{
 const list=(data as {activeStorms?:unknown})?.activeStorms;if(!Array.isArray(list))return [];
 return list.slice(0,32).flatMap((o:Record<string,unknown>)=>{
  const id=clean(o.id,12);if(!/^(al|ep|cp)\d{6}$/i.test(id))return [];
  const kt=num(o.intensity),lat=num(o.latitudeNumeric),lon=num(o.longitudeNumeric),cls=clean(o.classification,4).toUpperCase();
  const cat=cls==='HU'&&kt!==null?kt>=137?5:kt>=113?4:kt>=96?3:kt>=83?2:1:0;
  const kind=cat?`Category ${cat} Hurricane`:STORM[cls]??'Tropical system',name=clean(o.name,40);
  const dir=num(o.movementDir),speed=num(o.movementSpeed),mph=(k:number)=>Math.round(k*1.151);
  const detail=[kt!==null?`Winds ${mph(kt)} mph`:'',num(o.pressure)?`pressure ${num(o.pressure)} mb`:'',dir!==null&&speed!==null?`moving ${COMPASS[Math.round(dir/22.5)%16]} at ${mph(speed)} mph`:''].filter(Boolean).join(', ');
  const adv=(o.publicAdvisory as {url?:unknown})?.url;
  return [{id:`nhc:${id}`,kind:'hurricane' as const,title:`${kind} ${name}`,detail:detail?`${detail}.`:'',lat:valid(lat,lon)?lat:null,lon:valid(lat,lon)?lon:null,
   at:iso(o.lastUpdate),severity:cat>=3?1:cat?.85:/TS|STS/.test(cls)?.6:.4,source:'NOAA National Hurricane Center',url:typeof adv==='string'&&adv.startsWith('https://www.nhc.noaa.gov/')?adv:'https://www.nhc.noaa.gov/'}];
 });
}
/** NIFC WFIGS current perimeters (GeoJSON): one event per wildfire, placed at the middle of its perimeter. */
export function parseWfigs(data:unknown):WorldEvent[]{
 const list=(data as {features?:unknown})?.features;if(!Array.isArray(list))return [];
 return list.slice(0,300).flatMap((f:{properties?:Record<string,unknown>;geometry?:{coordinates?:unknown}})=>{
  const p=f.properties??{};if(p.attr_IncidentTypeCategory!==undefined&&p.attr_IncidentTypeCategory!=='WF')return [];
  const pts:number[][]=[];const walk=(c:unknown,d=0)=>{if(d>5||pts.length>4000||!Array.isArray(c))return;if(typeof c[0]==='number'&&typeof c[1]==='number')pts.push(c as number[]);else for(const x of c)walk(x,d+1);};walk(f.geometry?.coordinates);
  const lon=pts.length?pts.reduce((a,b)=>a+b[0],0)/pts.length:null,lat=pts.length?pts.reduce((a,b)=>a+b[1],0)/pts.length:null;
  const acres=num(p.attr_IncidentSize),pct=num(p.attr_PercentContained),name=clean(p.poly_IncidentName,60)||'Unnamed fire',state=clean(p.attr_POOState,8).replace(/^US-/,'');
  return [{id:`wfigs:${name}:${state}`,kind:'wildfire' as const,title:`${name} Fire${state?`, ${state}`:''}`,
   detail:[acres!==null?`${Math.round(acres).toLocaleString('en-US')} acres`:'',pct!==null?`${Math.round(pct)}% contained`:'containment not reported'].filter(Boolean).join(', ')+'.',
   lat:valid(lat,lon)?Math.round(lat!*1000)/1000:null,lon:valid(lat,lon)?Math.round(lon!*1000)/1000:null,at:null,
   severity:acres===null?.3:(acres>=50000?.9:acres>=10000?.75:acres>=1000?.55:.35)*(pct!==null&&pct>=90?.6:1),source:'National Interagency Fire Center',url:'https://www.nifc.gov/fire-information'}];
 }).sort((a,b)=>b.severity-a.severity);
}
/** NOAA National Water Prediction Service gauges: only those at (or forecast to reach) flood stage. */
const FLOOD:Record<string,[string,number]>={action:['near flood stage',.35],minor:['minor flooding',.6],moderate:['moderate flooding',.8],major:['major flooding',1]};
export function parseNwps(data:unknown):WorldEvent[]{
 const list=(data as {gauges?:unknown})?.gauges;if(!Array.isArray(list))return [];
 return list.slice(0,5000).flatMap((g:Record<string,unknown>)=>{
  const st=g.status as {observed?:Record<string,unknown>;forecast?:Record<string,unknown>}|undefined;
  const obs=FLOOD[String(st?.observed?.floodCategory)],fc=FLOOD[String(st?.forecast?.floodCategory)];
  if(!obs&&!(fc&&fc[1]>=.6))return [];
  const lat=num(g.latitude),lon=num(g.longitude),level=num(st?.observed?.primary),unit=clean(st?.observed?.primaryUnit,4)||'ft';
  const state=clean((g.state as {abbreviation?:unknown})?.abbreviation,2);
  const what=obs?obs[0]:`forecast to reach ${fc![0]}`;
  return [{id:`nwps:${clean(g.lid,10)}`,kind:'river' as const,title:`${clean(g.name,90)}${state?`, ${state}`:''}: ${what}`,
   detail:level!==null&&level>-900?`River level ${level} ${unit}.${obs&&fc&&fc[1]>obs[1]?` Forecast to reach ${fc[0]}.`:''}`:'',
   lat:valid(lat,lon)?lat:null,lon:valid(lat,lon)?lon:null,at:iso(st?.observed?.validTime),severity:Math.max(obs?.[1]??0,(fc?.[1]??0)*.85),
   source:'NOAA National Water Prediction Service',url:`https://water.noaa.gov/gauges/${encodeURIComponent(clean(g.lid,10).toLowerCase())}`}];
 }).sort((a,b)=>b.severity-a.severity).slice(0,40);
}
/** EMSC (seismicportal.eu) FDSN GeoJSON: worldwide, often minutes before other agencies. */
export function parseEmsc(data:unknown):WorldEvent[]{
 const list=(data as {features?:unknown})?.features;if(!Array.isArray(list))return [];
 return list.slice(0,200).flatMap((f:{properties?:Record<string,unknown>})=>{
  const p=f.properties??{},mag=num(p.mag),lat=num(p.lat),lon=num(p.lon);if(mag===null||!valid(lat,lon))return [];
  const region=clean(p.flynn_region,80).toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
  return [{id:`emsc:${clean(p.unid,40)}`,kind:'quake' as const,title:`Magnitude ${mag.toFixed(1)} earthquake, ${region}`,detail:num(p.depth)!==null?`${Math.round(num(p.depth)!)} km deep.`:'',
   lat,lon,at:iso(p.time),severity:mag>=6?1:mag>=5?.75:mag>=4?.5:.3,source:`EMSC${p.auth?` (${clean(p.auth,12)})`:''}`,url:`https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(clean(p.unid,40))}`}];
 });
}
/** USGS and EMSC report the same quakes: within 90 seconds and 100 km is the same one (USGS kept). */
export function mergeQuakes(usgs:readonly WorldEvent[],emsc:readonly WorldEvent[]):WorldEvent[]{
 const out=[...usgs];
 for(const e of emsc){const t=e.at?Date.parse(e.at):NaN;
  if(!out.some(u=>u.at&&Number.isFinite(t)&&Math.abs(Date.parse(u.at)-t)<=90000&&u.lat!==null&&e.lat!==null&&distanceKm(u.lat,u.lon!,e.lat,e.lon!)<=100))out.push(e);}
 return out;
}
const bbox=(n:Near,capKm=400)=>{const r=Math.min(n.radiusKm,capKm),dLat=r/111,dLon=r/(111*Math.max(.2,Math.cos(n.lat*Math.PI/180)));
 return {xmin:+(n.lon-dLon).toFixed(3),ymin:+(n.lat-dLat).toFixed(3),xmax:+(n.lon+dLon).toFixed(3),ymax:+(n.lat+dLat).toFixed(3)};};

// ---- fetching -----------------------------------------------------------------------------------------------
export interface FeedResult {kind:FeedKind;events:WorldEvent[];note:string|null;ok:boolean;}
export class WorldFeeds {
 #cache=new Map<string,{at:number;value:unknown}>();
 private fetch:Fetch;private keys:()=>Promise<Record<string,string>>;private now:()=>number;
 constructor(options:{fetch?:Fetch;keys?:()=>Promise<Record<string,string>>;now?:()=>number}={}){this.fetch=options.fetch??fetch;this.keys=options.keys??(async()=>({}));this.now=options.now??Date.now;}
 async #get(url:string,signal:AbortSignal|undefined,as:'json'|'text',ttlMs=5*60000,timeoutMs=15000):Promise<unknown>{
  const hit=this.#cache.get(url);if(hit&&this.now()-hit.at<ttlMs)return hit.value;
  const res=await this.fetch(url,{headers:{'User-Agent':UA,Accept:as==='json'?'application/geo+json, application/json':'application/xml, text/xml, */*'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
  if(!res.ok)throw new Error(`${res.status}`);
  const text=await res.text();if(text.length>8_000_000)throw new Error('too large');
  const value=as==='json'?JSON.parse(text):text;
  this.#cache.set(url,{at:this.now(),value});if(this.#cache.size>40)this.#cache.delete(this.#cache.keys().next().value!);
  return value;
 }
 /** One feed, as events. Failures come back as a note (so an answer can say what was unavailable), never thrown. */
 async feed(kind:FeedKind,signal?:AbortSignal,near?:Near):Promise<FeedResult>{
  try{
   const now=new Date(this.now());
   switch(kind){
    case 'volcano':return {kind,ok:true,note:null,events:parseHans(await this.#get('https://volcanoes.usgs.gov/hans-public/api/volcano/getCapElevated',signal,'json',15*60000))};
    case 'disaster':return {kind,ok:true,note:null,events:parseGdacs(String(await this.#get('https://www.gdacs.org/xml/rss_7d.xml',signal,'text',10*60000)))};
    case 'alert':return {kind,ok:true,note:null,events:parseNws(await this.#get('https://api.weather.gov/alerts/active?status=actual&severity=Extreme,Severe',signal,'json',3*60000))};
    case 'natural':return {kind,ok:true,note:null,events:parseEonet(await this.#get('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60&days=20',signal,'json',30*60000))};
    case 'outage':{
     // Most IODA alerts are about single networks; countries and regions are what's worth saying.
     const until=Math.floor(this.now()/1000),base=`https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts?from=${until-6*3600}&until=${until}&limit=500&entityType=`;
     const [c,r]=await Promise.all([this.#get(base+'country',signal,'json',10*60000),this.#get(base+'region',signal,'json',10*60000).catch(()=>({data:[]}))]);
     return {kind,ok:true,note:null,events:[...parseIoda(c),...parseIoda(r)]};}
    case 'airport':return {kind,ok:true,note:null,events:parseFaa(String(await this.#get('https://nasstatus.faa.gov/api/airport-status-information',signal,'text',5*60000)))};
    case 'cyber':return {kind,ok:true,note:null,events:parseKev(await this.#get('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',signal,'json',6*3600000),this.now())};
    case 'quake':{
     const [usgs,emsc]=await Promise.all([this.#get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',signal,'json',3*60000).then(parseQuakes),
      this.#get('https://www.seismicportal.eu/fdsnws/event/1/query?limit=150&format=json&minmag=2.5',signal,'json',2*60000).then(parseEmsc,()=>[])]);
     return {kind,ok:true,note:null,events:mergeQuakes(usgs,emsc)};}
    case 'hurricane':return {kind,ok:true,note:null,events:parseNhc(await this.#get('https://www.nhc.noaa.gov/CurrentStorms.json',signal,'json',5*60000))};
    case 'wildfire':{
     const q=new URLSearchParams({where:"attr_IncidentTypeCategory='WF'",outFields:'poly_IncidentName,attr_IncidentSize,attr_PercentContained,attr_POOState,attr_IncidentTypeCategory',
      returnGeometry:'true',maxAllowableOffset:'0.02',outSR:'4326',orderByFields:'attr_IncidentSize DESC',resultRecordCount:'150',f:'geojson'});
     if(near){const b=bbox(near,600);q.set('geometry',`${b.xmin},${b.ymin},${b.xmax},${b.ymax}`);q.set('geometryType','esriGeometryEnvelope');q.set('inSR','4326');q.set('spatialRel','esriSpatialRelIntersects');}
     return {kind,ok:true,note:null,events:parseWfigs(await this.#get(`https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?${q}`,signal,'json',10*60000))};}
    case 'river':{
     // The whole country is too slow to fetch (over 30 s), so rivers are checked around a place.
     if(!near)return {kind,ok:false,note:'Which place should I check the rivers near?',events:[]};
     const b=bbox(near,300);
     return {kind,ok:true,note:null,events:parseNwps(await this.#get(`https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=${b.xmin}&bbox.ymin=${b.ymin}&bbox.xmax=${b.xmax}&bbox.ymax=${b.ymax}&srid=EPSG_4326`,signal,'json',15*60000,30000))};}
    case 'fireball':return {kind,ok:true,note:null,events:parseFireballs(await this.#get('https://ssd-api.jpl.nasa.gov/fireball.api?limit=20&req-loc=true',signal,'json',60*60000))};
    case 'asteroid':{const key=(await this.keys()).NASA_API_KEY||'DEMO_KEY';return {kind,ok:true,note:null,events:parseNeo(await this.#get(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${now.toISOString().slice(0,10)}&end_date=${now.toISOString().slice(0,10)}&api_key=${encodeURIComponent(key)}`,signal,'json',60*60000))};}
    case 'space':{
     const [kp,xr]=await Promise.all([this.#get('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',signal,'json',10*60000).then(parseKp,()=>null),
      this.#get('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',signal,'json',10*60000).then(parseXray,()=>null)]);
     const ev:WorldEvent[]=[];
     if(kp)ev.push({id:'space:kp',kind,title:`Geomagnetic activity Kp ${kp.kp.toFixed(1)}${kp.kp>=5?` (G${Math.min(5,Math.floor(kp.kp)-4)} storm)`:kp.kp>=4?' (active)':' (quiet)'}`,detail:kp.kp>=5?'A geomagnetic storm: auroras may reach farther south than usual.':'',lat:null,lon:null,at:kp.at,severity:Math.min(1,kp.kp/9),source:'NOAA SWPC',url:'https://www.swpc.noaa.gov/'});
     if(xr)ev.push({id:'space:xray',kind,title:`Strongest solar flare in the last day: ${xr.cls}`,detail:xr.cls.startsWith('X')?'An X-class flare: brief radio blackouts are possible on the sunlit side of Earth.':xr.cls.startsWith('M')?'A moderate flare.':'',lat:null,lon:null,at:xr.at,severity:xr.cls.startsWith('X')?.9:xr.cls.startsWith('M')?.5:.15,source:'NOAA SWPC (GOES)',url:'https://www.swpc.noaa.gov/'});
     return {kind,ok:ev.length>0,note:ev.length?null:'Space weather data is unavailable right now.',events:ev};
    }
    case 'aurora':{
     if(!near)return {kind,ok:false,note:'Which place should I check for auroras?',events:[]};
     const chance=auroraChance(await this.#get('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',signal,'json',15*60000),near.lat,near.lon);
     if(chance===null)return {kind,ok:false,note:'The aurora forecast is unavailable right now.',events:[]};
     return {kind,ok:true,note:null,events:[{id:'aurora:here',kind,title:`Aurora chance overhead${near.name?` at ${near.name}`:''}: ${chance}%`,detail:chance>=30?'Worth a look north after dark, away from city lights.':chance>=10?'A faint chance, low on the northern horizon.':'Very unlikely right now.',lat:near.lat,lon:near.lon,at:new Date(this.now()).toISOString(),severity:Math.min(1,chance/60),source:'NOAA SWPC OVATION',url:'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast'}]};
    }
   }
  }catch(e){
   signal?.throwIfAborted();
   return {kind,ok:false,note:`${FEED_NAMES[kind]} is unavailable right now.`,events:[]};
  }
 }
}
export const FEED_NAMES:Record<FeedKind,string>={volcano:'Volcano alerts',disaster:'GDACS disaster alerts',alert:'Weather alerts',natural:'NASA natural events',space:'Space weather',aurora:'The aurora forecast',outage:'Internet outage data',fireball:'Fireball data',asteroid:'Asteroid data',quake:'USGS earthquakes',airport:'FAA airport status',cyber:'The CISA exploited-vulnerability list',hurricane:'Hurricane Center data',wildfire:'Wildfire data',river:'River gauge data'};

/** Keeps events near a place (those without coordinates are kept only for world-wide kinds), most severe first. */
export function nearby(events:readonly WorldEvent[],near:Near|null,limit=12):WorldEvent[]{
 const scored=events.map(e=>({e,d:near&&e.lat!==null&&e.lon!==null?distanceKm(near.lat,near.lon,e.lat,e.lon):null}))
  .filter(x=>!near||x.d===null&&['space','asteroid','outage','cyber'].includes(x.e.kind)||x.d!==null&&x.d<=near.radiusKm);
 return scored.sort((a,b)=>b.e.severity-a.e.severity||(a.d??0)-(b.d??0)).slice(0,limit).map(x=>({...x.e,...(x.d!==null?{detail:`${x.e.detail}${x.e.detail?' ':''}(${Math.round(x.d)} km away)`.trim()}:{})}));
}
/** Spoken-report text: facts first, calm, each with its source. */
export function report(label:string,results:readonly FeedResult[],events:readonly WorldEvent[],near:Near|null):string{
 const where=near?.name?` near ${near.name}`:'';
 const lines=[`${label}${where} (live public data; present it calmly and constructively: the facts, then what it means for the person or what is being done).`];
 if(!events.length)lines.push(`Nothing current${where}.`);
 for(const e of events)lines.push(`- ${e.title}${e.detail?`. ${e.detail}`:''}${e.at?` [${e.at.slice(0,16).replace('T',' ')} UTC]`:''} (${e.source})`);
 for(const r of results)if(r.note)lines.push(`Note: ${r.note}`);
 return lines.join('\n').slice(0,4000);
}
/** Pins for the God's Eye globe (GEV's annotate_map: at most 24). */
/** Severity and time filters from the request's words (after anhaoXie/gods-eye-view's hazard panel filters, MIT):
 * "only serious / major / severe" keeps the red ones; "today", "last hour", "this week", "last 6 hours" keep recent
 * ones. Events without a time pass the time filter (the feed didn't say). Returns the plain words used, for the reply. */
export function eventFilter(what:string,now=Date.now()):{keep:(e:WorldEvent)=>boolean;words:string|null}{
 const q=what.toLowerCase(),serious=/\b(only (the )?(serious|severe|major|big|red)|serious ones|major ones|just the (serious|severe|major|big) ones)\b/.test(q);
 const h=q.match(/\b(?:last|past) (\d{1,3}) ?(hours?|hrs?|days?)\b/);
 const ms=h?Number(h[1])*(h[2].startsWith('d')?86400000:3600000):/\b(last|past) hour\b/.test(q)?3600000:/\btoday\b|\blast 24 hours\b/.test(q)?86400000:/\bthis week\b|\blast week\b|\bpast week\b/.test(q)?7*86400000:0;
 const words=[serious?'serious ones only':null,ms?(ms<86400000?`last ${Math.round(ms/3600000)} hour${ms===3600000?'':'s'}`:ms===86400000?'last 24 hours':`last ${Math.round(ms/86400000)} days`):null].filter(Boolean).join(', ')||null;
 return {words,keep:e=>(!serious||e.severity>=.8)&&(!ms||!e.at||now-Date.parse(e.at)<=ms)};
}
export function pins(events:readonly WorldEvent[]):{type:'pin';latitude:number;longitude:number;label:string;color:string}[]{
 return events.filter(e=>e.lat!==null&&e.lon!==null).slice(0,24).map(e=>({type:'pin',latitude:e.lat!,longitude:e.lon!,label:e.title.slice(0,110),color:e.severity>=.8?'red':e.severity>=.5?'amber':'cyan'}));
}

/** Which feeds answer a request, decided from its words. null: not a world-feed question. */
export interface WorldRoute {kinds:FeedKind[];match:RegExp|null;label:string;radiusKm:number;needsPlace:boolean;layers?:string[];}
const WORLD:{test:RegExp;route:Omit<WorldRoute,'needsPlace'>&{needsPlace?:boolean}}[]=[
 {test:/\b(aurora|northern lights)\b/,route:{kinds:['aurora','space'],match:null,label:'aurora chances',radiusKm:20000,needsPlace:true}},
 {test:/\b(volcano(es)?|volcanic|eruptions?|ash)\b/,route:{kinds:['volcano','disaster','natural'],match:/volcan|erupt|VO\b/i,label:'volcano activity',radiusKm:3000}},
 {test:/\b(tsunamis?)\b/,route:{kinds:['alert','disaster'],match:/tsunami/i,label:'tsunami alerts',radiusKm:5000}},
 {test:/\b(hurricanes?|tropical (storms?|depressions?)|cyclones?|typhoons?)\b/,route:{kinds:['hurricane','disaster'],match:/hurricane|tropical|cyclone|typhoon|storm|TC\b/i,label:'tropical storms',radiusKm:3000,layers:['weather-cyclones']}},
 {test:/\b(wild ?fires?|forest fires?|fires? burning)\b/,route:{kinds:['wildfire','disaster'],match:/fire|WF\b/i,label:'wildfires',radiusKm:600,layers:['fire-perimeters']}},
 {test:/\b(floods?|flooding|flash flood|rivers?|flood stage)\b/,route:{kinds:['river','alert','disaster'],match:/flood|river/i,label:'flooding',radiusKm:300}},
 {test:/\b(tornado(es)?|severe weather|weather (alerts?|warnings?)|warnings?|watches)\b/,route:{kinds:['alert'],match:null,label:'severe weather alerts',radiusKm:250}},
 {test:/\b(disasters?|emergenc(y|ies)|catastroph)/,route:{kinds:['disaster'],match:null,label:'disaster alerts',radiusKm:3000}},
 {test:/\b(internet (outages?|down|blackouts?)|outages?)\b/,route:{kinds:['outage'],match:null,label:'internet outages',radiusKm:20000}},
 {test:/\b(space weather|solar (flares?|storms?|activity)|geomagnetic|sun ?spots?|flares?)\b/,route:{kinds:['space'],match:null,label:'space weather',radiusKm:20000}},
 {test:/\b(fireballs?|meteors?|bolides?|shooting stars?)\b/,route:{kinds:['fireball'],match:null,label:'recent fireballs',radiusKm:3000}},
 {test:/\b(asteroids?|near.earth|neos?)\b/,route:{kinds:['asteroid'],match:null,label:"today's asteroid close approaches",radiusKm:20000}},
 {test:/\b(airports?|ground stops?|flight delays?|flights? (delayed|late|cancell?ed))\b/,route:{kinds:['airport'],match:null,label:'US airport delays',radiusKm:400}},
 {test:/\b(cyber|vulnerabilit(y|ies)|exploit(s|ed)?|zero.days?|cves?|ransomware)\b/,route:{kinds:['cyber'],match:null,label:'actively exploited vulnerabilities',radiusKm:20000}},
 {test:/\b(natural events?|nature events?)\b/,route:{kinds:['natural'],match:null,label:'natural events',radiusKm:3000}},
 {test:/\b(world (brief|news|update|report)|what'?s happening in the world|state of the (world|planet)|around the world)\b/,route:{kinds:['disaster','alert','volcano','space'],match:null,label:'the world right now',radiusKm:20000}},
];
export function worldRoute(question:string,hasPlace:boolean):WorldRoute|null{
 const q=question.toLowerCase();
 for(const w of WORLD)if(w.test.test(q))return {...w.route,needsPlace:!!w.route.needsPlace&&!hasPlace};
 return null;
}
