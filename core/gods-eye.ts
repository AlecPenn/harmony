import {spawn as nodeSpawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {applyOverlay} from './gods-eye-overlay.ts';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

/** God's Eye View (github.com/bilawalsidhu/gods-eye-view, MIT), run and driven by HARMONY.
 *
 * HARMONY installs it at a pinned commit (scripts/setup-gods-eye.mjs), starts its local server on 127.0.0.1 only when
 * it's needed, asks it questions through its local MCP endpoint (live public data: flights, ships, quakes, fires,
 * storms, satellites, launches...), and shows answers on the globe in its own window. It stops after a quiet spell.
 * Nothing here sends your data anywhere: GEV fetches public feeds itself; questions go only to 127.0.0.1. */

export type GodsEyeState='NOT_INSTALLED'|'OFF'|'STARTING'|'READY'|'FAILED';
export interface GodsEyeStatus {state:GodsEyeState;commit:string|null;port:number;error:string|null;windowOpen:boolean;lastAsk:string|null;watching?:{id:string;name:string;radiusKm:number}[];overlay?:string|null;lite?:boolean;}
export interface GevView {camera?:{lat:number;lon:number;altitude_m:number;heading_deg?:number;pitch_deg?:number};layers?:string[];style?:string|null;map?:string|null;
 follow?:{kind:string;id:string;cockpit?:boolean}|null;annotations?:unknown[];}
export interface GevAnswer {ok:boolean;summary:string;view:GevView|null;url:string|null;data:unknown;}
type Spawner=(command:string,args:readonly string[],options:{cwd:string;windowsHide:true;stdio:'pipe';env:NodeJS.ProcessEnv;shell?:boolean})=>ChildProcessWithoutNullStreams;
export class GodsEyeError extends Error {}

export interface GodsEyePin {commit:string;folder:string;port:number;}
export function readPin(root:string):GodsEyePin|null{
 try{const p=JSON.parse(readFileSync(join(root,'docs','GODS-EYE-VIEW.json'),'utf8'));return /^[0-9a-f]{40}$/.test(p.commit)&&typeof p.folder==='string'&&Number.isInteger(p.port)?{commit:p.commit,folder:p.folder,port:p.port}:null;}catch{return null;}
}
/** The installed commit, or null when not set up (or set up for a different pin). */
export function installedCommit(root:string,pin:GodsEyePin|null=readPin(root)):string|null{
 if(!pin)return null;const dir=resolve(root,pin.folder);
 try{const m=JSON.parse(readFileSync(join(dir,'.harmony-installed.json'),'utf8'));return m.commit===pin.commit&&existsSync(join(dir,'node_modules','vite','bin','vite.js'))?m.commit:null;}catch{return null;}
}

/** Supervises GEV's dev server and talks to its MCP endpoint (JSON-RPC over HTTP POST to /mcp on 127.0.0.1). */
export class GodsEye {
 #child:ChildProcessWithoutNullStreams|null=null;#ready:Promise<boolean>|null=null;#state:GodsEyeState='OFF';#error:string|null=null;
 #idle:ReturnType<typeof setTimeout>|null=null;#id=1;#tools:{name:string}[]|null=null;#lastAsk:string|null=null;windowOpen=false;
 /** Whether HARMONY's overlay went on at the last start (shown in diagnostics). */
 overlay:string|null=null;
 private root:string;private pin:GodsEyePin|null;private spawn:Spawner;private fetch:typeof fetch;private env:()=>Promise<Record<string,string>>;private changed:()=>void;
 private idleMs:number;private node:string;
 constructor(root:string,options:{spawn?:Spawner;fetch?:typeof fetch;env?:()=>Promise<Record<string,string>>;changed?:()=>void;idleMs?:number;node?:string;pin?:GodsEyePin|null}={}){
  this.root=root;this.pin=options.pin===undefined?readPin(root):options.pin;this.spawn=options.spawn??(nodeSpawn as unknown as Spawner);this.fetch=options.fetch??fetch;
  this.env=options.env??(async()=>({}));this.changed=options.changed??(()=>{});this.idleMs=options.idleMs??20*60000;this.node=options.node??'node';
  if(!installedCommit(root,this.pin))this.#state='NOT_INSTALLED';
 }
 get port(){return this.pin?.port??4173;}
 get origin(){return `http://127.0.0.1:${this.port}`;}
 get installed(){return installedCommit(this.root,this.pin)!==null;}
 status():GodsEyeStatus{return {state:this.installed?this.#state==='NOT_INSTALLED'?'OFF':this.#state:'NOT_INSTALLED',commit:installedCommit(this.root,this.pin),port:this.port,error:this.#error,windowOpen:this.windowOpen,lastAsk:this.#lastAsk,overlay:this.overlay};}
 #set(s:GodsEyeState,error:string|null=null){this.#state=s;this.#error=error;try{this.changed();}catch{}}
 /** Starts GEV's server if needed and waits until its MCP endpoint answers. */
 ensure(signal?:AbortSignal):Promise<boolean>{
  this.#touch();
  if(this.#ready)return this.#ready;
  if(!this.installed){this.#set('NOT_INSTALLED');return Promise.resolve(false);}
  this.#set('STARTING');
  this.#ready=(async()=>{
   // Something else already on the port (an earlier HARMONY, or GEV you started yourself) is used if it answers as GEV.
   if(await this.#initialize(signal).catch(()=>false)){this.#set('READY');return true;}
   const dir=resolve(this.root,this.pin!.folder);let child:ChildProcessWithoutNullStreams;
   // HARMONY's changes (overlays/gods-eye: Lite mode and the community-fork features) go on first. If they can't be
   // applied (a file isn't the expected original), the plain pinned God's Eye View runs instead.
   try{const r=applyOverlay(dir,join(this.root,'overlays','gods-eye'),this.pin!.commit);this.overlay=r.skipped?`not applied: ${r.skipped}`:'applied';}
   catch(e){this.overlay=`not applied: ${e instanceof Error?e.message:'error'}`;}
   try{
    child=this.spawn(this.node,[join(dir,'node_modules','vite','bin','vite.js'),'--host','127.0.0.1','--port',String(this.port),'--strictPort'],
     {cwd:dir,windowsHide:true,stdio:'pipe',env:{...process.env,...await this.env(),BROWSER:'none',NO_COLOR:'1'}});
   }catch{this.#set('FAILED',"God's Eye couldn't start (is Node 24 installed?).");this.#ready=null;return false;}
   this.#child=child;child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
   child.on('error',()=>{});child.on('close',()=>{if(this.#child===child){this.#child=null;this.#ready=null;this.#tools=null;if(this.#state!=='OFF')this.#set('OFF');}});
   for(let i=0;i<120;i++){
    if(signal?.aborted||!this.#child)break;
    await new Promise(r=>setTimeout(r,500));
    if(await this.#initialize(signal).catch(()=>false)){this.#set('READY');return true;}
   }
   this.#set('FAILED',"God's Eye didn't come up in time.");void this.stop();return false;
  })();
  return this.#ready;
 }
 #touch(){if(this.#idle)clearTimeout(this.#idle);this.#idle=setTimeout(()=>{if(!this.windowOpen)void this.stop();else this.#touch();},this.idleMs);this.#idle.unref?.();}
 async #rpc(method:string,params:unknown,signal?:AbortSignal,timeoutMs=45000):Promise<Record<string,unknown>>{
  // No Origin header: GEV only accepts MCP requests that are plainly local (loopback address, loopback Host, no proxy).
  const res=await this.fetch(`${this.origin}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:this.#id++,method,params}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
  if(!res.ok)throw new GodsEyeError(`God's Eye answered ${res.status}`);
  const text=await res.text();if(text.length>3_000_000)throw new GodsEyeError('Answer too large');
  const body=JSON.parse(text) as {result?:Record<string,unknown>;error?:{message?:string}};
  if(body.error||!body.result)throw new GodsEyeError(body.error?.message?.slice(0,160)??'No answer');
  return body.result;
 }
 async #initialize(signal?:AbortSignal):Promise<boolean>{
  const r=await this.#rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'harmony',version:'1'}},signal,4000);
  return (r.serverInfo as {name?:string}|undefined)?.name==='gods-eye-view';
 }
 async tools(signal?:AbortSignal):Promise<string[]>{
  if(!this.#tools){const r=await this.#rpc('tools/list',{},signal);this.#tools=Array.isArray(r.tools)?(r.tools as {name:string}[]).filter(t=>typeof t?.name==='string'):[];}
  return this.#tools.map(t=>t.name);
 }
 /** GPS interference near a point, from God's Eye View's own GNSS-integrity endpoint (aircraft-reported navigation
  * accuracy from adsb.lol within 250 nautical miles; its classifier, gpsjam.org-style bands). Read-only, local. */
 async gnss(lat:number,lon:number,signal?:AbortSignal):Promise<GnssSummary>{
  if(!num(lat,-90,90)||!num(lon,-180,180))throw new GodsEyeError('Bad position');
  if(!await this.ensure(signal))throw new GodsEyeError("God's Eye isn't running.");
  this.#touch();
  const res=await this.fetch(`${this.origin}/api/gnss-integrity?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`,{headers:{Accept:'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  if(res.status===429)throw new GodsEyeError('The aircraft feed is busy right now. Try again in a minute.');
  if(!res.ok)throw new GodsEyeError('The aircraft feed is unavailable right now.');
  const text=await res.text();if(text.length>5_000_000)throw new GodsEyeError('Answer too large');
  return gnssSummary(JSON.parse(text));
 }
 /** One question to GEV. The summary is GEV's own text (from public data); the view says where to look on the globe. */
 async call(name:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<GevAnswer>{
  if(!/^[a-z_]{3,40}$/.test(name))throw new GodsEyeError('Bad tool');
  if(!await this.ensure(signal))throw new GodsEyeError(this.#state==='NOT_INSTALLED'?"God's Eye isn't set up yet. Run \"Set up God's Eye\" in the HARMONY folder.":this.#error??"God's Eye isn't running.");
  this.#touch();
  const r=await this.#rpc('tools/call',{name,arguments:args},signal);
  const content=Array.isArray(r.content)?(r.content as {type:string;text?:string}[]):[];
  const sc=(r.structuredContent&&typeof r.structuredContent==='object'?r.structuredContent:{}) as Record<string,unknown>;
  const summary=(typeof sc.summary==='string'?sc.summary:content.find(c=>c.type==='text'&&typeof c.text==='string'&&!c.text.trimStart().startsWith('{'))?.text??'').replace(/\s+/g,' ').trim().slice(0,1500);
  const data=(sc.data&&typeof sc.data==='object'?sc.data:sc) as Record<string,unknown>;
  const view=validView(data.view)??validView(sc.view);
  const url=typeof data.url==='string'?data.url:typeof sc.url==='string'?sc.url:null;
  this.#lastAsk=new Date().toISOString();
  return {ok:r.isError!==true,summary:r.isError===true?(summary&&!/try again later/i.test(summary)?summary:'That source is unavailable right now.'):summary,view,url:url&&url.startsWith(this.origin+'/')?url:null,data};
 }
 stop():Promise<void>{
  if(this.#idle){clearTimeout(this.#idle);this.#idle=null;}
  const child=this.#child;this.#child=null;this.#ready=null;this.#tools=null;
  if(this.installed)this.#set('OFF');
  if(!child)return Promise.resolve();
  return new Promise(r=>{const k=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}r();},3000);child.once('close',()=>{clearTimeout(k);r();});try{child.kill();}catch{clearTimeout(k);r();}});
 }
}

const num=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
/** Only the fields HARMONY applies, each range-checked; anything else is dropped. */
export function validView(v:unknown):GevView|null{
 if(!v||typeof v!=='object')return null;const o=v as Record<string,unknown>,out:GevView={};
 const c=o.camera as Record<string,unknown>|undefined;
 if(c&&num(c.lat,-90,90)&&num(c.lon,-180,180)&&num(c.altitude_m,1,40_000_000))out.camera={lat:c.lat as number,lon:c.lon as number,altitude_m:c.altitude_m as number,
  ...(num(c.heading_deg,0,360)?{heading_deg:c.heading_deg as number}:{}),...(num(c.pitch_deg,-90,90)?{pitch_deg:c.pitch_deg as number}:{})};
 if(Array.isArray(o.layers))out.layers=o.layers.filter((l):l is string=>typeof l==='string'&&/^[a-z0-9-]{2,40}$/.test(l)).slice(0,31);
 if(typeof o.style==='string'&&/^[a-z]{2,20}$/.test(o.style))out.style=o.style;
 if(o.follow&&typeof o.follow==='object'){const f=o.follow as Record<string,unknown>;if(typeof f.kind==='string'&&typeof f.id==='string'&&f.id.length<=60)out.follow={kind:f.kind.slice(0,30),id:f.id,cockpit:f.cockpit===true};}
 if(Array.isArray(o.annotations))out.annotations=o.annotations.slice(0,24);
 return out.camera||out.layers?.length||out.follow?out:null;
}

/** The script run inside the God's Eye window to show a view: GEV's own app actions (the same ones its voice control
 * uses), adding layers rather than removing yours, then flying the camera. Returns what worked. */
export function applyViewScript(view:GevView,place=''):string{
 return `(async(view,place)=>{
 const wait=async()=>{for(let i=0;i<120;i++){const g=window.__godsEyeView;if(g&&g.voiceCommands&&g.dataManager)return g;await new Promise(r=>setTimeout(r,250));}return null;};
 const g=await wait();if(!g)return {ok:false,reason:'loading'};
 const run=async(n,a)=>{try{const r=await g.voiceCommands.runner(n,a,{});return r&&r.ok!==false;}catch(e){return false;}};
 const done=[];
 if(view.style)done.push(['style',await run('set_visual_style',{style:view.style})]);
 for(const id of view.layers||[])if(!g.dataManager.isEnabled(id))done.push([id,await run('set_layer_visibility',{layerId:id,enabled:true})]);
 if(view.annotations&&view.annotations.length){await run('clear_annotations',{});done.push(['marks',await run('annotate_map',{annotations:view.annotations})]);}
 const follow=view.follow?({aircraft:'flights',military_aircraft:'military',satellite:'satellites'})[view.follow.kind]:null;
 if(follow&&await run('track_entity',{query:view.follow.id,layerId:follow}))done.push(['follow',true]);
 else if(view.camera)done.push(['camera',await run('fly_to_location',{latitude:view.camera.lat,longitude:view.camera.lon,rangeM:Math.max(100,Math.min(20000000,view.camera.altitude_m)),waitForArrival:false})]);
 else if(place)done.push(['place',await run('fly_to_location',{query:place,viewMode:'overview',waitForArrival:false})]);
 return {ok:done.every(d=>d[1]),done};
})(${JSON.stringify(view)},${JSON.stringify(place.slice(0,120))})`;
}

/** Ambient mode (a "living globe" for a spare screen): the whole Earth turning slowly with the HUD hidden and a few
 * light layers (measured on Alec's PC: these stay smooth; flights did not), using God's Eye View's own actions
 * (zoom_to_globe, move_camera rotate_globe from its globe rotation, set_hud). on=false stops the turning and brings
 * the HUD back. */
export const AMBIENT_LAYERS=['earthquakes','weather-cyclones','satellites'];
/** GPS interference, summed up from God's Eye View's /api/gnss-integrity answer. `percent` uses gpsjam.org's cell
 * formula (degraded aircraft minus one, over all, so one odd plane doesn't count) and God's Eye View's bands. */
export interface GnssSummary {total:number;degraded:number;lost:number;percent:number;level:'low'|'medium'|'high'|'unknown';radiusNm:number;ageMs:number|null;}
export function gnssSummary(body:unknown):GnssSummary{
 const b=(body&&typeof body==='object'?body:{}) as {rows?:unknown;radiusNm?:unknown;ageMs?:unknown};
 const rows=Array.isArray(b.rows)?b.rows.filter((r):r is {degraded?:unknown;gpsLost?:unknown}=>!!r&&typeof r==='object'):[];
 const total=rows.length,degraded=rows.filter(r=>r.degraded===true).length,lost=rows.filter(r=>r.gpsLost===true).length;
 const percent=total?Math.round(1000*Math.max(0,degraded-1)/total)/10:0;
 return {total,degraded,lost,percent,level:total<5?'unknown':percent>=10?'high':percent>=2?'medium':'low',
  radiusNm:typeof b.radiusNm==='number'&&b.radiusNm>0&&b.radiusNm<1000?b.radiusNm:250,ageMs:typeof b.ageMs==='number'&&b.ageMs>=0?b.ageMs:null};
}
/** The spoken answer for a place. */
export function gnssText(s:GnssSummary,place:string):string{
 if(s.level==='unknown')return `Too few aircraft are reporting near ${place} right now to judge GPS interference (${s.total} with position-quality data).`;
 const verdict=s.level==='high'?'High: that pattern usually means jamming or spoofing.':s.level==='medium'?'Elevated: some interference is likely, or a few aircraft with poor equipment.':'Normal: no sign of jamming.';
 return `Around ${place} (within ${s.radiusNm} nautical miles), ${s.degraded} of ${s.total} aircraft report degraded GPS${s.lost?`, ${s.lost} lost it entirely`:''} (${s.percent}%). ${verdict} The map shows it on the globe.`;
}

export function ambientScript(on:boolean):string{
 return `(async(on,layers)=>{
 const wait=async()=>{for(let i=0;i<120;i++){const g=window.__godsEyeView;if(g&&g.voiceCommands&&g.dataManager)return g;await new Promise(r=>setTimeout(r,250));}return null;};
 const g=await wait();if(!g)return {ok:false,reason:'loading'};
 const run=async(n,a)=>{try{const r=await g.voiceCommands.runner(n,a,{});return r&&r.ok!==false;}catch(e){return false;}};
 if(!on){await run('move_camera',{motion:'stop'});await run('set_hud',{visible:'auto'});return {ok:true};}
 for(const p of ['data-panel','scene-panel','global-context-panel','weather-panel'])await run('set_panel_open',{panelId:p,open:false});
 for(const id of layers)if(!g.dataManager.isEnabled(id))await run('set_layer_visibility',{layerId:id,enabled:true});
 await run('zoom_to_globe',{});await new Promise(r=>setTimeout(r,2500));
 await run('set_hud',{visible:'off'});
 const turning=await run('move_camera',{motion:'rotate_globe',direction:'left',speed:'slow',mode:'continuous'});
 return {ok:turning};
})(${JSON.stringify(on)},${JSON.stringify(AMBIENT_LAYERS)})`;
}

/** Replay: events toured in time order on the globe ("replay today's earthquakes"). Each stop is pinned (earlier ones
 * stay) and the camera flies to it, a few seconds apart, then pulls back to the whole Earth. Inspired by
 * kuxala/gods-eye-view's event date scrubber (MIT). Up to 12 stops; labels and colours come from HARMONY. */
export interface ReplayStop {lat:number;lon:number;label:string;color:'red'|'amber'|'cyan';}
export function replayScript(stops:readonly ReplayStop[],dwellMs=3500):string{
 const clean=stops.filter(s=>num(s.lat,-90,90)&&num(s.lon,-180,180)).slice(0,12).map(s=>({lat:s.lat,lon:s.lon,label:String(s.label).slice(0,110),color:['red','amber','cyan'].includes(s.color)?s.color:'cyan'}));
 return `(async(stops,dwell)=>{
 const wait=async()=>{for(let i=0;i<120;i++){const g=window.__godsEyeView;if(g&&g.voiceCommands)return g;await new Promise(r=>setTimeout(r,250));}return null;};
 const g=await wait();if(!g)return {ok:false,reason:'loading'};
 const run=async(n,a)=>{try{const r=await g.voiceCommands.runner(n,a,{});return r&&r.ok!==false;}catch(e){return false;}};
 const pins=[];await run('clear_annotations',{});
 for(const s of stops){
  pins.push({type:'pin',latitude:s.lat,longitude:s.lon,label:s.label,color:s.color});
  await run('clear_annotations',{});await run('annotate_map',{annotations:pins});
  await run('fly_to_location',{latitude:s.lat,longitude:s.lon,rangeM:2500000,waitForArrival:false});
  await new Promise(r=>setTimeout(r,dwell));
 }
 await run('zoom_to_globe',{});
 return {ok:true,stops:stops.length};
})(${JSON.stringify(clean)},${Math.max(1500,Math.min(8000,dwellMs))})`;
}

/** What to ask God's Eye for a spoken request, decided by HARMONY (not the model), so it is fast and predictable.
 * `layers` are turned on in the window even when the question is answered from data alone. */
export interface GevRoute {tool:string|null;args:Record<string,unknown>;layers:string[];needsPlace:boolean;label:string;}
const ROUTES:{test:RegExp;tool:string|null;label:string;layers:string[];args:(area:Record<string,unknown>|null,q:string)=>Record<string,unknown>|null}[]=[
 // GPS jamming (God's Eye View's GNSS-integrity layer: adsb.lol aircraft navigation accuracy, gpsjam.org-style cells).
 {test:/\b(gps|gnss)\b.*\b(jam\w*|interfer\w*|spoof\w*|outages?|problems?)\b|\b(jamm(ing|ed)|spoofing)\b/,tool:null,label:'GPS interference',layers:['gnss-integrity'],args:()=>({})},
 {test:/\b(military|fighter|bomber|tanker|warplanes?)\b/,tool:'military_awareness',label:'military activity',layers:['military','military-awareness'],args:a=>a?{location:a.place?{place:a.place}:{lat:a.lat,lon:a.lon},radius_km:150}:null},
 {test:/\b(flights?|planes?|aircraft|airplanes?|jets?|helicopters?|overhead traffic)\b/,tool:'aircraft_in_area',label:'flights',layers:['flights'],args:a=>a?{area:a,limit:10}:null},
 {test:/\b(ships?|boats?|vessels?|tankers?|cargo|maritime|port)\b/,tool:'vessels_in_area',label:'ships',layers:['ais-live-vessels'],args:a=>a?{area:a,limit:10}:null},
 {test:/\b(earthquakes?|quakes?|seismic|tremors?)\b/,tool:'get_earthquakes',label:'earthquakes',layers:['earthquakes'],args:a=>a?{area:a,limit:10}:{limit:10}},
 {test:/\b(fires?|wildfires?|burning|smoke)\b/,tool:'get_active_fires',label:'fires',layers:['local-firms','fire-perimeters'],args:a=>a?{area:a,limit:10}:null},
 {test:/\b(hurricanes?|cyclones?|typhoons?|tropical storms?)\b/,tool:'get_cyclones',label:'tropical storms',layers:['weather-cyclones'],args:()=>({})},
 {test:/\b(launch(es)?|rockets?|spacex|liftoff)\b/,tool:'get_recent_launches',label:'launches',layers:['rocket-launches'],args:()=>({limit:5})},
 {test:/\b(iss|space station)\b.*\b(when|see|pass|visible|next)\b|\b(when|see|pass|visible|next)\b.*\b(iss|space station)\b/,tool:'next_satellite_pass',label:'the next ISS pass',layers:['satellites'],args:a=>a?{location:a.place?{place:a.place}:{lat:a.lat,lon:a.lon}}:null},
 {test:/\b(satellites?|iss|space station|starlink)\b/,tool:'satellites_overhead',label:'satellites overhead',layers:['satellites'],args:(a,q)=>a?{location:a.place?{place:a.place}:{lat:a.lat,lon:a.lon},group:/starlink/.test(q)?'starlink':'stations',limit:10}:null},
 {test:/\b(traffic|congestion|roads?)\b/,tool:'get_traffic_flow',label:'traffic',layers:['traffic'],args:a=>a?{area:a}:null},
 {test:/\b(radar|rain|precipitation|lightning|weather)\b/,tool:'situation_brief',label:'the weather picture',layers:['weather-radar','weather-lightning'],args:a=>a?{area:a}:null},
 {test:/\b(cables?|undersea|internet backbone)\b/,tool:'find_submarine_cables',label:'undersea cables',layers:['telegeography-submarine-cables'],args:a=>a?{area:a}:{}},
 {test:/\b(data ?cent(er|re)s?)\b/,tool:'find_infrastructure',label:'datacenters',layers:['local-datacenters'],args:a=>a?{kind:'datacenters',area:a,limit:10}:null},
 {test:/\b(dams?)\b/,tool:'find_infrastructure',label:'dams',layers:['local-dams'],args:a=>a?{kind:'dams',area:a,limit:10}:null},
 {test:/\b(cameras?|cctv|webcams?)\b/,tool:'find_cctv_cameras',label:'public cameras',layers:['cctv'],args:a=>a?{area:a,limit:10}:null},
 {test:/\b(air quality|pollution|aqi|smog)\b/,tool:null,label:'air quality',layers:['air-quality'],args:()=>({})},
 {test:/\b(wind)\b/,tool:null,label:'wind',layers:['wind'],args:()=>({})},
];
export function routeQuestion(question:string,place:string):GevRoute{
 const q=question.toLowerCase(),p=place.trim().slice(0,120);
 const area=p?{place:p}:null;
 for(const r of ROUTES)if(r.test.test(q)){
  const args=r.args(area,q);
  return {tool:args?r.tool:null,args:args??{},layers:r.layers,needsPlace:!!r.tool&&args===null,label:r.label};
 }
 // "What's going on in Tokyo?" — an overview of a place.
 return area?{tool:'situation_brief',args:{area},layers:[],needsPlace:false,label:`what's happening around ${p}`}:{tool:null,args:{},layers:[],needsPlace:false,label:'the globe'};
}
