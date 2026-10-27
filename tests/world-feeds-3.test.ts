import {expect,it} from 'vitest';
import {parseNhc,parseWfigs,parseNwps,parseEmsc,parseQuakes,mergeQuakes,worldRoute,nearby,WorldFeeds} from '../core/world-feeds.ts';

// Shapes copied from the live responses fetched on Alec's PC on October 22, 2026.
const NHC={activeStorms:[{id:'al102026',binNumber:'AT5',name:'Josephine',classification:'STS',intensity:'55',pressure:'988',latitude:'38.7N',longitude:'68.3W',latitudeNumeric:38.7,longitudeNumeric:-68.3,movementDir:40,movementSpeed:13,lastUpdate:'2026-10-22T09:00:00.000Z',publicAdvisory:{advNum:'003',url:'https://www.nhc.noaa.gov/text/MIATCPAT5.shtml'}},
 {id:'ep142026',name:'Kiko',classification:'HU',intensity:'115',pressure:'945',latitudeNumeric:15.2,longitudeNumeric:-120.5,movementDir:280,movementSpeed:10,lastUpdate:'2026-10-22T09:00:00.000Z',publicAdvisory:{url:'https://evil.example/x'}},{id:'bad'}]};
const WFIGS={type:'FeatureCollection',properties:{exceededTransferLimit:true},features:[
 {type:'Feature',geometry:{type:'Polygon',coordinates:[[[-81.534,29.081],[-81.486,29.068],[-81.508,29.048],[-81.534,29.081]]]},properties:{poly_IncidentName:'Shell',attr_IncidentSize:2822,attr_PercentContained:100,attr_POOState:'US-FL',attr_IncidentTypeCategory:'WF'}},
 {type:'Feature',geometry:{type:'MultiPolygon',coordinates:[[[[-121.1,40.1],[-121.0,40.2],[-120.9,40.1],[-121.1,40.1]]]]},properties:{poly_IncidentName:'Ridge',attr_IncidentSize:61000,attr_PercentContained:null,attr_POOState:'US-CA',attr_IncidentTypeCategory:'WF'}},
 {type:'Feature',geometry:{type:'Polygon',coordinates:[[[-90,44],[-90.1,44],[-90,44.1],[-90,44]]]},properties:{poly_IncidentName:'Burn unit 3',attr_IncidentSize:40,attr_IncidentTypeCategory:'RX'}}]};
const gauge=(lid:string,name:string,obs:string,fc='fcst_not_current',level=5)=>({lid,name,rfc:{},wfo:{},state:{abbreviation:'WI',name:'Wisconsin'},latitude:43.5,longitude:-89.4,pedts:{},
 status:{observed:{primary:level,primaryUnit:'ft',secondary:2.3,secondaryUnit:'kcfs',floodCategory:obs,validTime:'2026-10-22T12:00:00Z'},forecast:{primary:-999,primaryUnit:'',floodCategory:fc,validTime:'0001-01-01T00:00:00Z'}}});
const EMSC={type:'FeatureCollection',metadata:{count:2},features:[
 {type:'Feature',geometry:{type:'Point',coordinates:[133.63,-3.09,-17]},id:'20261022_0000208',properties:{source_catalog:'EMSC-RTS',time:'2026-10-22T13:45:57.0Z',flynn_region:'PAPUA, INDONESIA',lat:-3.09,lon:133.63,depth:17,auth:'BMKG',mag:3.1,magtype:'m',unid:'20261022_0000208'}},
 {type:'Feature',geometry:{type:'Point',coordinates:[-122.8,38.8,-2]},id:'x',properties:{time:'2026-10-22T10:00:30.0Z',flynn_region:'NORTHERN CALIFORNIA',lat:38.81,lon:-122.79,depth:2,mag:4.2,unid:'20261022_0000100'}}]};

it('hurricanes: names, categories, winds in mph, direction, and only official advisory links',()=>{
 const ev=parseNhc(NHC);
 expect(ev.map(e=>e.title)).toEqual(['Subtropical Storm Josephine','Category 4 Hurricane Kiko']);
 expect(ev[0]).toMatchObject({detail:'Winds 63 mph, pressure 988 mb, moving northeast at 15 mph.',lat:38.7,lon:-68.3,severity:.6,url:'https://www.nhc.noaa.gov/text/MIATCPAT5.shtml'});
 expect(ev[1]).toMatchObject({severity:1,url:'https://www.nhc.noaa.gov/'});
 expect(parseNhc({activeStorms:[]})).toEqual([]);expect(parseNhc(null)).toEqual([]);
});
it('wildfires: one point per fire at the middle of its perimeter, biggest first; prescribed burns left out',()=>{
 const ev=parseWfigs(WFIGS);
 expect(ev.map(e=>e.title)).toEqual(['Ridge Fire, CA','Shell Fire, FL']);
 expect(ev[0]).toMatchObject({detail:'61,000 acres, containment not reported.',severity:.9});
 expect(ev[1].detail).toBe('2,822 acres, 100% contained.');expect(ev[1].severity).toBeCloseTo(.33);
 expect(ev[1].lat).toBeCloseTo(29.07,1);expect(ev[1].lon).toBeCloseTo(-81.52,1);
});
it('rivers: only gauges at or forecast to reach flood stage, worst first',()=>{
 const ev=parseNwps({gauges:[gauge('A','Wisconsin River at Portage','minor','fcst_not_current',17.2),gauge('B','Yahara River at Windsor','no_flooding'),gauge('C','Rock River at Afton','no_flooding','moderate'),gauge('D','Pecatonica','obs_not_current'),gauge('E','Fox River at Berlin','major','major',14)]});
 expect(ev.map(e=>e.title)).toEqual(['Fox River at Berlin, WI: major flooding','Rock River at Afton, WI: forecast to reach moderate flooding','Wisconsin River at Portage, WI: minor flooding']);
 expect(ev[2].detail).toBe('River level 17.2 ft.');expect(ev[0].url).toBe('https://water.noaa.gov/gauges/e');
 expect(parseNwps({gauges:[gauge('B','x','no_flooding')]})).toEqual([]);
});
it('EMSC quakes merge with USGS without duplicates',()=>{
 const emsc=parseEmsc(EMSC);
 expect(emsc[0]).toMatchObject({title:'Magnitude 3.1 earthquake, Papua, Indonesia',detail:'17 km deep.',source:'EMSC (BMKG)'});
 const usgs=parseQuakes({features:[{id:'nc1',geometry:{coordinates:[-122.8,38.8,2]},properties:{mag:4.3,place:'5 km NW of The Geysers, CA',time:Date.parse('2026-10-22T10:00:05Z')}}]});
 const all=mergeQuakes(usgs,emsc);
 expect(all.map(e=>e.source)).toEqual(['USGS','EMSC (BMKG)']); // the California quake is one event, kept from USGS
});
it('questions route to the new feeds, and rivers are fetched around a place',async()=>{
 expect(worldRoute('any hurricanes right now?',false)).toMatchObject({kinds:['hurricane','disaster'],layers:['weather-cyclones']});
 expect(worldRoute('are there wildfires in California',true)).toMatchObject({kinds:['wildfire','disaster'],layers:['fire-perimeters']});
 expect(worldRoute('is the river flooding near Madison',true)?.kinds).toEqual(['river','alert','disaster']);
 const urls:string[]=[];
 const feeds=new WorldFeeds({fetch:(async(u:string)=>{urls.push(String(u));return new Response(JSON.stringify({gauges:[gauge('A','Wisconsin River at Portage','minor')]}));}) as never});
 expect((await feeds.feed('river')).note).toMatch(/Which place/);expect(urls).toHaveLength(0);
 const r=await feeds.feed('river',undefined,{lat:43.07,lon:-89.4,radiusKm:250,name:'Madison'});
 expect(r.events).toHaveLength(1);expect(urls[0]).toMatch(/^https:\/\/api\.water\.noaa\.gov\/nwps\/v1\/gauges\?bbox\.xmin=-92\.48\d*&bbox\.ymin=40\.818/);
 expect(nearby(r.events,{lat:43.07,lon:-89.4,radiusKm:250,name:'Madison'})[0].detail).toMatch(/km away/);
});
