import {describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GodsEye,routeQuestion,validView,applyViewScript,installedCommit} from '../core/gods-eye.ts';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {AssistantActions,type GodsEyeBridge} from '../core/assistant-actions.ts';

const COMMIT='e84e74ca3a7d200182591934d3630202e3f1a568';
function fakeRoot(installed=true){
 const root=mkdtempSync(join(tmpdir(),'gev-'));mkdirSync(join(root,'docs'));
 writeFileSync(join(root,'docs','GODS-EYE-VIEW.json'),JSON.stringify({commit:COMMIT,folder:'.runtime/gods-eye-view',port:4173}));
 if(installed){const d=join(root,'.runtime','gods-eye-view');mkdirSync(join(d,'node_modules','vite','bin'),{recursive:true});writeFileSync(join(d,'node_modules','vite','bin','vite.js'),'');writeFileSync(join(d,'.harmony-installed.json'),JSON.stringify({commit:COMMIT}));}
 return root;
}
const rpc=(handler:(method:string,params:Record<string,unknown>,init:RequestInit)=>unknown)=>(async(url:string|URL|Request,init?:RequestInit)=>{
 expect(String(url)).toBe('http://127.0.0.1:4173/mcp');expect((init!.headers as Record<string,string>).Origin).toBeUndefined();
 const body=JSON.parse(String(init!.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:handler(body.method,body.params,init!)}),{status:200});
}) as typeof fetch;

describe('routing a spoken request',()=>{
 it('picks the right live source and layers',()=>{
  expect(routeQuestion('show me flights','Chicago')).toMatchObject({tool:'aircraft_in_area',args:{area:{place:'Chicago'},limit:10},layers:['flights']});
  expect(routeQuestion('any earthquakes today','')).toMatchObject({tool:'get_earthquakes',args:{limit:10}});
  expect(routeQuestion('where is GPS being jammed right now','')).toMatchObject({tool:null,layers:['gnss-integrity'],label:'GPS interference'});
  expect(routeQuestion('any gps spoofing near planes in the baltic','')).toMatchObject({layers:['gnss-integrity']});
  expect(routeQuestion('when can I see the ISS','Madison, Wisconsin')).toMatchObject({tool:'next_satellite_pass',args:{location:{place:'Madison, Wisconsin'}}});
  expect(routeQuestion('starlink satellites overhead','Madison')).toMatchObject({tool:'satellites_overhead',args:{group:'starlink'}});
  expect(routeQuestion('military planes','San Diego').tool).toBe('military_awareness');
  expect(routeQuestion('hurricanes','').tool).toBe('get_cyclones');
  expect(routeQuestion('show me datacenters','Virginia').args).toMatchObject({kind:'datacenters'});
  expect(routeQuestion("what's going on",'Tokyo')).toMatchObject({tool:'situation_brief',args:{area:{place:'Tokyo'}}});
  expect(routeQuestion('','')).toMatchObject({tool:null,layers:[]});
  expect(routeQuestion('wind','')).toMatchObject({tool:null,layers:['wind']});
  // A source that needs a place says so instead of guessing.
  expect(routeQuestion('flights','')).toMatchObject({tool:null,needsPlace:true});
 });
});

describe('views',()=>{
 it('keeps only checked fields',()=>{
  expect(validView({camera:{lat:95,lon:0,altitude_m:10}})).toBeNull();
  expect(validView({camera:{lat:41,lon:-87,altitude_m:5000,pitch_deg:-90},layers:['flights','<script>'],style:'surveillance',evil:1})).toEqual({camera:{lat:41,lon:-87,altitude_m:5000,pitch_deg:-90},layers:['flights'],style:'surveillance'});
 });
 it('the in-page script carries the view and place as data, not code',()=>{
  const s=applyViewScript({layers:['flights']},'"); alert(1); ("');
  expect(s).toContain(JSON.stringify('"); alert(1); ("'));expect(()=>new Function(`return ${s}`)).not.toThrow();
 });
});

describe('the God\'s Eye supervisor',()=>{
 it('is NOT_INSTALLED until set up, and says how to fix it',async()=>{
  const g=new GodsEye(fakeRoot(false),{fetch:rpc(()=>({}))});
  expect(g.status().state).toBe('NOT_INSTALLED');await expect(g.call('get_earthquakes',{})).rejects.toThrow(/Set up God's Eye/);
 });
 it('reuses a GEV already answering on the port, and parses summary and view',async()=>{
  const root=fakeRoot();expect(installedCommit(root)).toBe(COMMIT);
  let spawned=0;
  const g=new GodsEye(root,{spawn:(()=>{spawned++;throw new Error('no');}) as never,fetch:rpc((m,p)=>m==='initialize'?{serverInfo:{name:'gods-eye-view'}}
   :m==='tools/call'&&(p as {name:string}).name==='get_earthquakes'?{content:[{type:'text',text:'3 earthquakes, strongest M5.1 near Hokkaido.'},{type:'text',text:'{"rows":[]}'}],structuredContent:{rows:[],view:{camera:{lat:43,lon:142,altitude_m:900000},layers:['earthquakes']},url:'http://127.0.0.1:4173/#v=2'},isError:false}
   :{content:[{type:'text',text:'The tool failed; try again later'}],structuredContent:{error:'unavailable'},isError:true})});
  const a=await g.call('get_earthquakes',{limit:10});
  expect(spawned).toBe(0);expect(a).toMatchObject({ok:true,summary:'3 earthquakes, strongest M5.1 near Hokkaido.',view:{layers:['earthquakes']},url:'http://127.0.0.1:4173/#v=2'});
  const b=await g.call('get_cyclones',{});expect(b.ok).toBe(false);expect(b.summary).toBe('That source is unavailable right now.');
  expect(g.status().state).toBe('READY');await g.stop();
 });
 it('refuses odd tool names',async()=>{const g=new GodsEye(fakeRoot(),{fetch:rpc(()=>({}))});await expect(g.call('../x',{})).rejects.toThrow();});
});

describe('the gods_eye function',()=>{
 function setup(available=true){
  const db=openDatabase(':memory:'),opened:unknown[]=[],calls:unknown[]=[];
  const bridge:GodsEyeBridge={available:()=>available,open:async v=>{opened.push(v);},close:async()=>true,
   call:async(t,a)=>{calls.push([t,a]);return {ok:true,summary:'12 aircraft within 50 km of Chicago; nearest UAL123 at 3,200 m.',view:{camera:{lat:41.9,lon:-87.6,altitude_m:60000},layers:['flights']},url:null,data:{}};}};
  const actions=new AssistantActions(new ReminderStore(db),db,()=>{},undefined,null,null,null,null,null,null,null,{godsEye:bridge});
  return {actions,opened,calls,db};
 }
 it('asks the right source, answers from it, and shows it on the globe',async()=>{
  const {actions,opened,calls}=setup();
  expect(actions.tools.some(t=>t.name==='gods_eye')).toBe(true);
  const r=await actions.run([{name:'gods_eye',arguments:{action:'open',what:'flights',place:'Chicago'}}],new AbortController().signal);
  expect(calls).toEqual([['aircraft_in_area',{area:{place:'Chicago'},limit:10}]]);
  expect(r.lookup?.report).toContain('12 aircraft within 50 km of Chicago');
  await new Promise(r=>setTimeout(r,5));expect(opened[0]).toMatchObject({layers:['flights'],place:'Chicago',view:{camera:{lat:41.9}}});
 });
 it('just opening speaks a fixed line; a missing place is asked for; close works',async()=>{
  const {actions,opened}=setup();
  const a=await actions.run([{name:'gods_eye',arguments:{action:'open',what:'',place:''}}],new AbortController().signal);
  expect(a.spoken).toBe("Opening God's Eye.");expect(a.lookup).toBeUndefined();expect(opened).toHaveLength(1);
  const b=await actions.run([{name:'gods_eye',arguments:{action:'open',what:'flights',place:''}}],new AbortController().signal);
  expect(b.spoken).toMatch(/Which place/);
  const c=await actions.run([{name:'gods_eye',arguments:{action:'close',what:'',place:''}}],new AbortController().signal);
  expect(c.spoken).toBe("Closed God's Eye.");
 });
 it('not set up: a plain instruction, and the exact command shortcut',async()=>{
  const {actions}=setup(false);
  const r=await actions.run([{name:'gods_eye',arguments:{action:'open',what:'',place:''}}],new AbortController().signal);
  expect(r.spoken).toMatch(/Set up God's Eye/);
  expect(actions.shortcut("Harmony, open God's Eye.")).toContain('<function=gods_eye>');
 });
});

describe.skipIf(!process.env.HARMONY_TEST_GEV)('against a real God\'s Eye View on 127.0.0.1:4173',()=>{
 it('initializes, lists its tools and builds a view',async()=>{
  const g=new GodsEye(fakeRoot());
  expect((await g.tools()).length).toBeGreaterThan(20);
  const a=await g.call('show_in_gods_eye_view',{area:{lat:43.07,lon:-89.4,radius_km:30},layers:['flights']});
  expect(a.ok).toBe(true);expect(a.view?.layers).toContain('flights');expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:4173\//);
 },60000);
});

it('every function offered to the local brain fits its limits (description at most 300 characters, at most 24 functions)',async()=>{
 const A=await import('../core/assistant-actions.ts');
 const all=[...A.reminderModelTools,A.statusModelTool,A.modeModelTool,...A.memoryModelTools,A.recallModelTool,...A.projectModelTools,A.desktopModelTools.look,A.desktopModelTools.control,
  A.workspaceModelTool,...A.webModelTools,A.researchModelTool,A.godsEyeModelTool,A.googleModelTools.calendar,A.googleModelTools.gmail,A.skillsModelTool,A.workModelTool];
 expect(all.length).toBeLessThanOrEqual(24);
 for(const t of all)expect(t.description.length,t.name).toBeLessThanOrEqual(300);
});

it('ambient mode words, and its script uses only God\'s Eye\'s own actions',async()=>{
 const {ambientIntent}=await import('../core/assistant-actions.ts');const {ambientScript}=await import('../core/gods-eye.ts');
 for(const q of ['ambient mode','start the living globe','screensaver mode please','spin the globe'])expect(ambientIntent(q),q).toBe(true);
 for(const q of ['stop ambient mode','turn off the screensaver','stop spinning'])expect(ambientIntent(q),q).toBe(false);
 expect(ambientIntent('show me earthquakes')).toBeNull();
 const on=ambientScript(true);expect(on).toContain("'rotate_globe'");expect(on).toContain("'zoom_to_globe'");expect(on).not.toMatch(/fetch\(|eval\(/);
 expect(ambientScript(false)).toContain("motion:'stop'");
});

it('GPS interference: gpsjam-style percentages, God\'s Eye bands, and plain words',async()=>{
 const {gnssSummary,gnssText}=await import('../core/gods-eye.ts');
 const mk=(bad:number,good:number,lost=0)=>({radiusNm:250,ageMs:4000,rows:[...Array.from({length:bad},(_,i)=>({degraded:true,gpsLost:i<lost})),...Array.from({length:good},()=>({degraded:false}))]});
 expect(gnssSummary(mk(1,99))).toMatchObject({total:100,degraded:1,percent:0,level:'low'}); // one odd plane doesn't count
 expect(gnssSummary(mk(6,94))).toMatchObject({percent:5,level:'medium'});
 const high=gnssSummary(mk(30,70,4));expect(high).toMatchObject({percent:29,level:'high',lost:4});
 expect(gnssText(high,'Gdańsk')).toMatch(/30 of 100 aircraft.*4 lost it.*jamming or spoofing/);
 expect(gnssSummary(mk(0,3)).level).toBe('unknown');expect(gnssText(gnssSummary(mk(0,3)),'Madison')).toMatch(/Too few aircraft/);
 expect(gnssSummary({rows:'nope'})).toMatchObject({total:0,level:'unknown'});expect(gnssSummary(null).total).toBe(0);
});
