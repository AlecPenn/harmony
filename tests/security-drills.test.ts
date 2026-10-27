import {expect,it} from 'vitest';
import * as tls from 'node:tls';
import {openDatabase} from '../core/storage.ts';
import {runDrills,drillSummary,SecurityDrills,must} from '../core/security-drills.ts';
import {distrustInNode} from '../core/tls-trust.ts';

it('every drill holds against the current build (sandboxed: nothing real is touched)',async()=>{
 (tls as unknown as {setDefaultCACertificates?:(c:string[])=>void}).setDefaultCACertificates?.((tls as unknown as {getCACertificates:(k:string)=>string[]}).getCACertificates('bundled'));
 distrustInNode([/eMudhra/i,/emSign/i]); // as HARMONY does at start
 const r=await runDrills();
 for(const x of r.results)expect(x.passed,`${x.id}: ${x.detail}`).toBe(true);
 expect(r.results.map(x=>x.id)).toEqual(['approval-replay','stranger-voice','photo-spoof','stranger-thumbs-up','duress','injection-web','injection-email','spiral-forged','lookalike-window','distrusted-ca','backup-tamper']);
 expect(drillSummary(r)).toMatch(/^Security drills: all 11 held/);
},60000);
it('a defense that gives way is reported plainly, and a crashing drill too',async()=>{
 const r=await runDrills([{id:'ok',name:'Fine',run:()=>'held'},{id:'weak',name:'Weak lock',run:()=>{must(false,'the door opened');return '';}},{id:'crash',name:'Crashy',run:()=>{throw new Error('boom');}}]);
 expect(r.results[0]).toMatchObject({passed:true,detail:'held'});
 expect(r.results[1]).toMatchObject({passed:false,detail:'Did not hold: the door opened.'});
 expect(r.results[2]).toMatchObject({passed:false,detail:'The drill itself failed: boom'});
 expect(r.failed).toBe(2);expect(drillSummary(r)).toBe('Security drills: 2 of 3 did not hold: weak lock (the door opened.); crashy (The drill itself failed: boom)');
});
it('runs monthly when Alec is away, remembers the report, and tells him only when something didn\'t hold',async()=>{
 const db=openDatabase(':memory:'),clock={t:Date.parse('2026-10-22T15:00:00Z')};let idle=0;const told:string[]=[];
 const s=new SecurityDrills(db,()=>idle,r=>{if(r.failed)told.push(drillSummary(r));},()=>new Date(clock.t));
 expect(s.due()).toBe(false);idle=700;expect(s.due()).toBe(true);
 const r=await s.run();expect(r.results.length).toBe(11);
 clock.t+=20*86400000;expect(s.due()).toBe(false);clock.t+=11*86400000;expect(s.due()).toBe(true);idle=0;expect(s.due()).toBe(false);clock.t+=5*86400000;expect(s.due()).toBe(true);
 expect(new SecurityDrills(db,()=>0,()=>{}).last?.at).toBe(r.at);
},60000);
