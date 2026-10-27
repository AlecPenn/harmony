import {expect,test} from 'vitest';
import {deflateRawSync} from 'node:zlib';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {arrivalsText,buildStatic,busIntent,csv,findStops,headsignText,MadisonMetro,parseAlerts,parseTripUpdates,unzip,type MetroStatic} from '../core/metro.ts';

// A tiny protocol-buffer writer, enough to build GTFS-realtime test feeds.
const vint=(n:number):number[]=>{const out:number[]=[];let v=n<0?2**64+n:n;do{let b=v%128;v=Math.floor(v/128);if(v>0)b|=128;out.push(b);}while(v>0);return out;};
const num=(no:number,v:number)=>[...vint(no*8),...vint(v)];
const bytes=(no:number,b:number[])=>[...vint(no*8+2),...vint(b.length),...b];
const str=(no:number,s:string)=>bytes(no,[...new TextEncoder().encode(s)]);
const stu=(stop:string,time:number,skipped=false)=>bytes(2,[...str(4,stop),...bytes(2,[...num(1,-30),...num(2,time)]),...(skipped?num(5,1):[])]);
const trip=(id:string,route:string,stops:number[][])=>bytes(2,[...str(1,id),...bytes(3,[...bytes(1,[...str(1,id),...str(5,route)]),...stops.flat()])]);
const feed=(...entities:number[][])=>new Uint8Array([...bytes(1,[...str(1,'2.0')]),...entities.flat()]);

const ST:MetroStatic={fetched:new Date().toISOString(),stops:[['1','E Johnson at N Livingston','1121'],['2','E Johnson at N Livingston','1122'],['3','Capitol Square','0100'],['4','Langdon at N Park','0010']],
 routes:{A:['A','Rapid Route A'],'28':['28','Route 28']},trips:{t1:['A','2-AMERICAN CENTER'],t2:['A','JUNCTION'],t3:['28','U.W. HOSPITAL']}};
const NOW=1_800_000_000;

test('GTFS-realtime trip updates: arrivals per stop, skipped stops left out, negative delays read',()=>{
 const f=feed(trip('t1','A',[stu('1',NOW+240),stu('3',NOW+600,true)]),trip('t2','A',[stu('2',NOW+90)]));
 expect(parseTripUpdates(f)).toEqual([{tripId:'t1',routeId:'A',stopId:'1',time:NOW+240},{tripId:'t2',routeId:'A',stopId:'2',time:NOW+90}]);
 expect(()=>parseTripUpdates(new Uint8Array([0x0a,0x7f,1]))).toThrow();
});
test('alerts: English text, routes, stops and active period',()=>{
 const ts=(no:number,t:string)=>bytes(no,bytes(1,[...str(1,t),...str(2,'en')]));
 const a=bytes(2,[...str(1,'x'),...bytes(5,[...bytes(1,[...num(1,NOW-10),...num(2,NOW+1000)]),...bytes(5,str(2,'A')),...ts(10,'A detour'),...ts(11,'Route A detours around Main St.')])]);
 expect(parseAlerts(feed(a))).toEqual([{header:'A detour',description:'Route A detours around Main St.',routes:['A'],stops:[],start:NOW-10,end:NOW+1000}]);
});
test('the answer: soonest first, per route and direction, in minutes, with alerts that touch those routes',()=>{
 const arrivals=[{tripId:'t1',routeId:'A',stopId:'1',time:NOW+240},{tripId:'t1',routeId:'A',stopId:'1',time:NOW+1500},{tripId:'t2',routeId:'A',stopId:'2',time:NOW+90},{tripId:'t3',routeId:'28',stopId:'4',time:NOW+60}];
 const stop=findStops(ST,'johnson and livingston')!;expect(stop.ids).toEqual(['1','2']);
 const alert={header:'A detour',description:'',routes:['A'],stops:[],start:null,end:null};
 expect(arrivalsText(ST,arrivals,[alert],stop,'',NOW*1000)).toBe('At E Johnson at N Livingston: the A to Junction in 2 minutes; the A to American Center in 4 minutes, then 25 minutes. Metro alert: A detour');
 expect(arrivalsText(ST,arrivals,[],stop,'28',NOW*1000)).toMatch(/^No live arrivals at E Johnson at N Livingston for the 28/);
 expect(findStops(ST,'stop 0010')?.name).toBe('Langdon at N Park');expect(findStops(ST,'nowhere street')).toBeNull();
 expect(headsignText('U.W. HOSPITAL')).toBe('UW Hospital');
});
test('spoken bus questions are recognised without the brain',()=>{
 expect(busIntent("When's the next bus at Capitol Square?")).toEqual({action:'times',stop:'capitol square',route:''});
 expect(busIntent('when does route B come')).toEqual({action:'times',stop:'',route:'b'});
 expect(busIntent('Is the number six late?')).toEqual({action:'times',stop:'',route:'six'});
 expect(busIntent('Harmony, my bus stop is Johnson and Livingston')).toEqual({action:'save',stop:'johnson and livingston',route:''});
 expect(busIntent('what is the weather')).toBeNull();expect(busIntent('tell me about the bus industry')).toBeNull();
});
test('the schedule zip and CSV (quoted fields), read without extra libraries',()=>{
 const files:Record<string,string>={'stops.txt':'stop_id,stop_code,stop_name\n1,1121,"E Johnson at N Livingston"\n','routes.txt':'route_id,route_short_name,route_long_name\nA,A,"Rapid Route A, east-west"\n','trips.txt':'route_id,trip_id,trip_headsign\nA,t1,JUNCTION\n'};
 const parts:Buffer[]=[],dir:Buffer[]=[];let offset=0;
 for(const [name,text] of Object.entries(files)){
  const data=deflateRawSync(Buffer.from(text)),n=Buffer.from(name),h=Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(8,8);h.writeUInt32LE(data.length,18);h.writeUInt32LE(text.length,22);h.writeUInt16LE(n.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(8,10);c.writeUInt32LE(data.length,20);c.writeUInt32LE(text.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  parts.push(h,n,data);dir.push(c,n);offset+=30+n.length+data.length;
 }
 const cd=Buffer.concat(dir),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(3,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 const out=unzip(new Uint8Array(Buffer.concat([...parts,cd,end])),['stops.txt','routes.txt','trips.txt']);
 const st=buildStatic(out,'2026-10-26T00:00:00Z');
 expect(st.routes.A).toEqual(['A','Rapid Route A, east-west']);expect(st.trips.t1).toEqual(['A','JUNCTION']);expect(st.stops).toEqual([['1','E Johnson at N Livingston','1121']]);
 expect(csv('a,b\r\n"x ""y""",2\r\n')).toEqual([{a:'x "y"',b:'2'}]);
});
test('the whole lookup: a saved stop, schedule cached on disk, live feed fetched',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'metro-'));let schedule=0;
 const zipOf=(st:MetroStatic)=>st; // the schedule is pre-seeded below; only the live feeds are fetched
 const m=new MadisonMetro(dir,(async(url:string)=>{
  if(url.includes('/trips'))return new Response(feed(trip('t1','A',[stu('1',NOW+300)])));
  if(url.includes('/alerts'))return new Response(feed());
  schedule++;return new Response('nope',{status:500});
 }) as typeof fetch,()=>NOW*1000);
 const {writeFileSync}=await import('node:fs');writeFileSync(join(dir,'schedule.json'),JSON.stringify(zipOf({...ST,fetched:new Date(NOW*1000).toISOString()})));
 await expect(m.next('','',new AbortController().signal)).rejects.toThrow(/Which stop/);
 expect(await m.saveStop('Johnson and Livingston',new AbortController().signal)).toBe('E Johnson at N Livingston');
 expect(await m.next('','',new AbortController().signal)).toBe('At E Johnson at N Livingston: the A to American Center in 5 minutes.');
 expect(schedule).toBe(0);
});
