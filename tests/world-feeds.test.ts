import {describe,expect,it} from 'vitest';
import {parseHans,parseGdacs,parseNws,parseEonet,parseKp,parseXray,flareClass,auroraChance,parseIoda,parseFireballs,parseNeo,nearby,report,pins,worldRoute,WorldFeeds,distanceKm} from '../core/world-feeds.ts';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {AssistantActions,type GodsEyeBridge} from '../core/assistant-actions.ts';
import {WebLookup} from '../core/web.ts';

const GDACS=`<?xml version="1.0"?><rss xmlns:gdacs="http://www.gdacs.org" xmlns:georss="http://www.georss.org/georss"><channel>
<item><title>Orange earthquake alert (Magnitude 6.4M, Depth:10km) in Japan 21/10/2026 03:12 UTC</title><description><![CDATA[On 10/21/2026, an earthquake &amp; tsunami risk]]></description>
<link>https://www.gdacs.org/report.aspx?eventid=1500001&amp;eventtype=EQ</link><pubDate>Wed, 21 Oct 2026 03:12:00 GMT</pubDate><gdacs:alertlevel>Orange</gdacs:alertlevel><gdacs:eventtype>EQ</gdacs:eventtype><gdacs:eventid>1500001</gdacs:eventid><georss:point>38.1 142.9</georss:point></item>
<item><title>Green volcano alert for Etna</title><gdacs:alertlevel>Green</gdacs:alertlevel><gdacs:eventtype>VO</gdacs:eventtype><gdacs:eventid>9</gdacs:eventid><georss:point>37.75 14.99</georss:point><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>No point</title><gdacs:eventtype>FL</gdacs:eventtype></item></channel></rss>`;
const NWS={features:[
 {properties:{id:'urn:1','@id':'https://api.weather.gov/alerts/urn:1',event:'Tornado Warning',areaDesc:'Dane, WI',headline:'Tornado Warning issued October 21',severity:'Extreme',effective:'2026-10-21T17:00:00-05:00'},geometry:{type:'Polygon',coordinates:[[[-89.5,43.0],[-89.3,43.0],[-89.3,43.2],[-89.5,43.2],[-89.5,43.0]]]}},
 {properties:{id:'urn:2',event:'Flood Warning',areaDesc:'Harris, TX',headline:'Flood Warning',severity:'Severe',effective:'2026-10-21T08:00:00-05:00'},geometry:null}]};

describe('parsers (shaped like each live feed)',()=>{
 it('USGS HANS volcanoes',()=>{
  const v=parseHans([{volcanoName:'Kilauea',alertLevel:'WATCH',colorCode:'ORANGE',latitude:19.42,longitude:-155.29},{volcanoName:'Nowhere',latitude:0,longitude:0},'junk']);
  expect(v).toHaveLength(1);expect(v[0]).toMatchObject({kind:'volcano',title:'Kilauea: WATCH (aviation orange)',severity:.75,lat:19.42});
  // The current HANS getCapElevated shape, as seen live on October 21, 2026.
  const live=parseHans([{volcano_name_appended:'Great Sitkin Volcano',latitude:52.0765,longitude:-176.1109,vnum:'311120',obs_fullname:'Alaska Volcano Observatory',alert_level:'WATCH',color_code:'ORANGE',
   synopsis:'Slow eruption of lava within the summit crater continues.',sent_date_cap:'2026-10-20T11:48:31-08:00',notice_url:'https://volcanoes.usgs.gov/hans-public/notice/DOI-USGS-AVO-2026-10-20T19:46:48+00:00'}]);
  expect(live[0]).toMatchObject({title:'Great Sitkin: WATCH (aviation orange)',detail:'Slow eruption of lava within the summit crater continues.',source:'Alaska Volcano Observatory',at:'2026-10-20T19:48:31.000Z'});
 });
 it('GDACS RSS',()=>{
  const g=parseGdacs(GDACS);expect(g).toHaveLength(2);
  expect(g[0]).toMatchObject({kind:'disaster',lat:38.1,lon:142.9,severity:.7,source:'GDACS Earthquake',url:'https://www.gdacs.org/report.aspx?eventid=1500001&eventtype=EQ'});
  expect(g[0].detail).toBe('On 10/21/2026, an earthquake & tsunami risk');expect(g[0].at).toBe('2026-10-21T03:12:00.000Z');
 });
 it('NWS alerts, with polygon centroids',()=>{
  const n=parseNws(NWS);expect(n[0]).toMatchObject({title:'Tornado Warning: Dane, WI',severity:1});expect(n[0].lat).toBeCloseTo(43.08,1);
  expect(n[1]).toMatchObject({lat:null,severity:.75});
 });
 it('EONET, Kp (both shapes), X-ray flares, OVATION, IODA, fireballs, NeoWs',()=>{
  expect(parseEonet({events:[{id:'E1',title:'Wildfire X',categories:[{title:'Wildfires'}],geometry:[{date:'2026-10-20T00:00:00Z',coordinates:[-120,38]}],sources:[{url:'https://x'}]}]})[0]).toMatchObject({lat:38,lon:-120,detail:'Wildfires'});
  expect(parseKp([['time_tag','Kp','a_running','station_count'],['2026-10-21 12:00:00.000','5.33','56','8']])).toMatchObject({kp:5.33});
  expect(parseKp([{time_tag:'2026-10-21T12:00:00',Kp:2.67}])).toMatchObject({kp:2.67});
  expect(flareClass(2.3e-5)).toBe('M2.3');expect(flareClass(1.2e-4)).toBe('X1.2');expect(flareClass(4e-7)).toBe('B4.0');
  expect(parseXray([{time_tag:'2026-10-21T10:00:00Z',energy:'0.1-0.8nm',flux:3e-6},{energy:'0.05-0.4nm',flux:1},{time_tag:'2026-10-21T11:00:00Z',energy:'0.1-0.8nm',flux:5.1e-5}])).toMatchObject({cls:'M5.1'});
  expect(auroraChance({coordinates:[[270,43,12],[271,43,9]]},43.07,-89.6)).toBe(12);
  const io=parseIoda({data:[{entity:{name:'Iran',type:'country',code:'IR'},time:1792600000,level:'critical',datasource:'bgp'},{entity:{name:'Iran',type:'country',code:'IR'},time:1792500000,level:'warning'},{entity:{name:'X',code:'X'},level:'normal'}]});
  expect(io).toHaveLength(1);expect(io[0].severity).toBe(.8);
  expect(parseFireballs({fields:['date','energy','impact-e','lat','lat-dir','lon','lon-dir','alt','vel'],data:[['2026-10-19 04:12:10','2.1','0.08','12.3','S','45.6','W','30','18']]})[0]).toMatchObject({lat:-12.3,lon:-45.6,title:'Fireball (0.08 kt)'});
  expect(parseNeo({near_earth_objects:{'2026-10-21':[{id:'1',name:'(2026 AB)',is_potentially_hazardous_asteroid:false,estimated_diameter:{meters:{estimated_diameter_max:42}},close_approach_data:[{miss_distance:{lunar:'3.2'}}]}]}})[0].title).toBe("Asteroid (2026 AB) passes 3.2 times the Moon's distance");
 });
});

describe('near, report, pins, routes',()=>{
 it('keeps nearby events, most severe first, with distances',()=>{
  const ev=[...parseNws(NWS),...parseGdacs(GDACS)];
  const near=nearby(ev,{lat:43.07,lon:-89.4,radiusKm:250,name:'Madison'});
  expect(near).toHaveLength(1);expect(near[0].detail).toMatch(/km away/);
  expect(distanceKm(43.07,-89.4,41.88,-87.63)).toBeGreaterThan(190);
  const r=report('Severe weather alerts',[{kind:'alert',ok:true,note:null,events:ev},{kind:'volcano',ok:false,note:'Volcano alerts is unavailable right now.',events:[]}],near,{lat:0,lon:0,radiusKm:1,name:'Madison'});
  expect(r).toMatch(/near Madison/);expect(r).toMatch(/Tornado Warning/);expect(r).toMatch(/unavailable/);expect(r).toMatch(/calmly and constructively/);
  expect(pins(ev)[0]).toMatchObject({type:'pin',color:'red'});expect(pins(ev).every(p=>p.label.length<=110)).toBe(true);
 });
 it('routes v9 topics',()=>{
  expect(worldRoute('any volcano eruptions',false)?.kinds).toContain('volcano');
  expect(worldRoute('tsunami warnings',false)?.match?.source).toBe('tsunami');
  expect(worldRoute('can I see the northern lights tonight',false)).toMatchObject({needsPlace:true});
  expect(worldRoute('can I see the northern lights tonight',true)).toMatchObject({needsPlace:false});
  expect(worldRoute('solar flares',false)?.kinds).toEqual(['space']);
  expect(worldRoute('give me a world brief',false)?.kinds.length).toBe(4);
  expect(worldRoute('show me flights',false)).toBeNull();
 });
});

describe('the feeds client',()=>{
 it('fetches with a User-Agent, caches, and turns failures into notes',async()=>{
  let calls=0;
  const f=new WorldFeeds({fetch:(async(url:string,init:RequestInit)=>{calls++;expect((init.headers as Record<string,string>)['User-Agent']).toMatch(/HARMONY/);
   if(String(url).includes('gdacs'))return new Response(GDACS);if(String(url).includes('weather.gov'))return new Response('x',{status:503});return new Response('{}');}) as never});
  expect((await f.feed('disaster')).events).toHaveLength(2);await f.feed('disaster');expect(calls).toBe(1);
  const bad=await f.feed('alert');expect(bad).toMatchObject({ok:false,note:'Weather alerts is unavailable right now.'});
  expect((await f.feed('aurora')).note).toMatch(/Which place/);
 });
});

describe('asking HARMONY',()=>{
 it('"any severe weather near Madison" answers from NWS and pins it on the globe; works before God\'s Eye is set up',async()=>{
  const db=openDatabase(':memory:'),opened:unknown[]=[];
  const fetcher=(async(url:string)=>String(url).includes('geocoding')?new Response(JSON.stringify({results:[{name:'Madison',admin1:'Wisconsin',country:'United States',latitude:43.07,longitude:-89.4}]}))
   :String(url).includes('weather.gov')?new Response(JSON.stringify(NWS)):new Response('{}')) as never;
  for(const available of [true,false]){
   opened.length=0;
   const bridge:GodsEyeBridge={available:()=>available,open:async v=>{opened.push(v);},close:async()=>true,call:async()=>{throw new Error('not used');}};
   const actions=new AssistantActions(new ReminderStore(db),db,()=>{},undefined,null,new WebLookup(fetcher),null,null,null,null,null,{godsEye:bridge,world:new WorldFeeds({fetch:fetcher})});
   const r=await actions.run([{name:'gods_eye',arguments:{action:'open',what:'any severe weather warnings',place:'Madison'}}],new AbortController().signal);
   expect(r.lookup?.report).toMatch(/Tornado Warning: Dane, WI/);expect(r.lookup?.report).not.toMatch(/Harris/);
   await new Promise(r=>setTimeout(r,5));
   if(available)expect(opened[0]).toMatchObject({view:{camera:{lat:43.07},annotations:[{type:'pin',color:'red'}]}});else expect(opened).toHaveLength(0);
  }
 });
});

it('severity and time filters from the request words',async()=>{
 const {eventFilter}=await import('../core/world-feeds.ts');
 const now=Date.parse('2026-10-26T18:00:00Z'),ev=(severity:number,hoursAgo:number|null)=>({id:'x',kind:'disaster' as const,title:'t',detail:'',lat:1,lon:1,at:hoursAgo===null?null:new Date(now-hoursAgo*3600000).toISOString(),severity,source:'s',url:null});
 const serious=eventFilter('only the serious disasters',now);expect(serious.words).toBe('serious ones only');expect(serious.keep(ev(.9,1))).toBe(true);expect(serious.keep(ev(.5,1))).toBe(false);
 const today=eventFilter('earthquakes today',now);expect(today.words).toBe('last 24 hours');expect(today.keep(ev(.5,3))).toBe(true);expect(today.keep(ev(.5,30))).toBe(false);expect(today.keep(ev(.5,null))).toBe(true);
 expect(eventFilter('disasters in the last 6 hours',now).words).toBe('last 6 hours');
 expect(eventFilter('any volcanoes',now)).toMatchObject({words:null});
});
