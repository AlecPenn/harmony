import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../core/storage.ts';
import {runSelfCheck,checkModels,SelfCheck,type SelfCheckDeps} from '../core/self-check.ts';
import type {GuardStatus} from '../core/guardian.ts';

function fakeRoot(){
 const root=mkdtempSync(join(tmpdir(),'selfcheck-'));mkdirSync(join(root,'docs'));mkdirSync(join(root,'data','models'),{recursive:true});
 writeFileSync(join(root,'docs','SPEECH-MODELS.json'),JSON.stringify({files:[{path:'data/models/a.onnx',bytes:3},{path:'data/models/b.bin',bytes:4}]}));
 writeFileSync(join(root,'docs','WAKE-MODEL.json'),JSON.stringify({files:[{path:'data/models/w.mdl',bytes:2}]}));
 writeFileSync(join(root,'docs','GUARD-MODELS.json'),JSON.stringify({models:{voice:{path:'data/models/v.onnx',bytes:5},escape:{path:'docs/WAKE-MODEL.json',bytes:1}}}));
 writeFileSync(join(root,'docs','GODS-EYE-VIEW.json'),JSON.stringify({commit:'e84e74ca3a7d',folder:'.runtime/gev'}));
 writeFileSync(join(root,'data','models','a.onnx'),'abc');writeFileSync(join(root,'data','models','b.bin'),'abcd');
 return root;
}
const guard=(p:Partial<GuardStatus>={}):GuardStatus=>({ready:true,cipher:true,settings:{voice:true,face:false,strangers:'guest',phone:'always',changes:false,autoLock:true,lockAfterMin:15,veil:true},
 voice:{enrolled:3,adaptive:0,threshold:.48,model:true},face:{enrolled:0,threshold:.4,model:true,lastSeen:null},duress:false,locked:null,lastVoice:null,onlookers:0,veil:false,paused:null,approvals:[],faceRequest:0,events:[],...p});

it('models: as pinned is fine, absent optional is off, changed or partial is a problem, and paths outside the models folder never pass',()=>{
 const root=fakeRoot();
 const byId=()=>Object.fromEntries(checkModels(root).map(i=>[i.id,i]));
 expect(byId()['model:speech'].health).toBe('ok');expect(byId()['model:wake'].health).toBe('off');
 expect(byId()['model:guard'].health).toBe('problem'); // one entry points outside data/models
 writeFileSync(join(root,'data','models','b.bin'),'abcde');expect(byId()['model:speech']).toMatchObject({health:'problem',detail:expect.stringMatching(/changed size/)});
});
it('a healthy PC gets one calm line; problems name what and how to fix',()=>{
 const root=fakeRoot(),db=openDatabase(':memory:'),now=new Date('2026-10-22T03:00:00Z');
 const made:string[]=[];
 const deps:SelfCheckDeps={root,dataRoot:root,db,now:()=>now,freeBytes:()=>50*1024**3,guard:()=>guard(),trust:()=>({removed:['eMudhra Root CA']}),
  backups:{list:()=>made.map(at=>({at})),daily:()=>{made.unshift(now.toISOString());}}};
 writeFileSync(join(root,'docs','GUARD-MODELS.json'),'{}');
 let r=runSelfCheck(deps);
 expect(made).toHaveLength(1); // no backup in a day: she makes one
 expect(r.problems).toBe(0);expect(r.warnings).toBe(0);expect(r.summary).toMatch(/^Self-check: all \d+ checks fine\.$/);
 expect(r.items.find(i=>i.id==='godseye')?.health).toBe('off');
 mkdirSync(join(root,'.runtime','gev'),{recursive:true});writeFileSync(join(root,'.runtime','gev','.harmony-installed.json'),JSON.stringify({commit:'0000000aaaa'}));
 r=runSelfCheck({...deps,freeBytes:()=>3*1024**3,guard:()=>guard({voice:{enrolled:0,adaptive:0,threshold:.48,model:true},paused:'x'})});
 expect(r.items.find(i=>i.id==='godseye')).toMatchObject({health:'problem',fix:expect.stringMatching(/Set up God's Eye/)});
 expect(r.items.find(i=>i.id==='disk')?.health).toBe('warn');expect(r.items.find(i=>i.id==='security')?.health).toBe('warn');
 expect(r.problems).toBe(1);expect(r.summary).toMatch(/god's eye/);expect(r.summary).toMatch(/3\.0 GB free/);
 r=runSelfCheck({...deps,freeBytes:()=>.5*1024**3,guard:()=>guard({cipher:false}),trust:()=>null,backups:{list:()=>[],daily:()=>{throw new Error('disk full');}}});
 for(const id of ['disk','security','backup'])expect(r.items.find(i=>i.id===id)?.health).toBe('problem');
 expect(r.items.find(i=>i.id==='trust')?.health).toBe('warn');
});
it('one failing check never stops the others',()=>{
 const root=fakeRoot(),db=openDatabase(':memory:');db.close();
 const r=runSelfCheck({root,dataRoot:root,db,freeBytes:()=>50*1024**3});
 expect(r.items.find(i=>i.id==='database')).toMatchObject({health:'problem',detail:expect.stringMatching(/Couldn't check/)});
 expect(r.items.some(i=>i.id==='disk'&&i.health==='ok')).toBe(true);
});
it('runs once a day while you are away, remembers the report, and only notifies when something needs you',()=>{
 const root=fakeRoot(),db=openDatabase(':memory:'),clock={t:Date.parse('2026-10-22T03:00:00Z')};let idle=0;const told:string[]=[];
 writeFileSync(join(root,'docs','GUARD-MODELS.json'),'{}');
 const deps:SelfCheckDeps={root,dataRoot:root,db,now:()=>new Date(clock.t),freeBytes:()=>50*1024**3};
 const sc=new SelfCheck(deps,()=>idle,r=>told.push(r.summary));
 expect(sc.tick()).not.toBeNull();expect(told).toEqual([]); // first run: healthy, silent
 clock.t+=21*3600000;expect(sc.tick()).toBeNull(); // a day later but you're at the PC
 idle=700;deps.freeBytes=()=>.2*1024**3;expect(sc.tick()?.problems).toBe(1);expect(told[0]).toMatch(/disk space/);
 expect(new SelfCheck(deps,()=>0,()=>{}).last?.at).toBe(new Date(clock.t).toISOString()); // kept across restarts
 clock.t+=49*3600000;idle=0;expect(sc.tick()).not.toBeNull(); // two days overdue: runs even while you're busy
});
it('off-PC backup: a warning while off, fine when recent, a problem when stale',()=>{
 const root=fakeRoot(),db=openDatabase(':memory:'),now=new Date('2026-10-22T15:00:00Z');
 writeFileSync(join(root,'docs','GUARD-MODELS.json'),'{}');
 const base:SelfCheckDeps={root,dataRoot:root,db,now:()=>now,freeBytes:()=>50*1024**3};
 const item=(o:{on:boolean;confirmed:boolean;newest:string|null}|null)=>runSelfCheck({...base,offsite:()=>o}).items.find(i=>i.id==='offsite');
 expect(item({on:false,confirmed:false,newest:null})).toMatchObject({health:'warn',fix:expect.stringMatching(/OneDrive/)});
 expect(item({on:true,confirmed:true,newest:'2026-10-22T03:00:00Z'})).toMatchObject({health:'ok',detail:'Newest is 12 hours old'});
 expect(item({on:true,confirmed:true,newest:'2026-10-17T03:00:00Z'})).toMatchObject({health:'problem',detail:'Newest is 5 days old'});
 expect(item(null)).toBeUndefined(); // status not known yet: no line
});
