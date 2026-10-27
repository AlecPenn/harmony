import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test,expect} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ActionJournal,type ActionPlan} from '../core/action-journal.ts';
import {actionInputHash} from '../packages/permissions/policy.ts';
const plan:ActionPlan={personId:'fixture',turnId:'turn_fixture',intent:'notes.create',toolId:'notes.create',toolVersion:1,risk:'LOW_RISK_WRITE',permission:'human',requestHash:actionInputHash('private request fixture'),inputsHash:actionInputHash({text:'private note fixture'})};
test('journal separates execution from verification and tracks undo without raw content',()=>{
 const db=openDatabase(':memory:');try{
  const j=new ActionJournal(db),id=j.prepare(plan);let revision=j.transition(id,0,'RUNNING');
  expect(()=>j.transition(id,revision,'SUCCEEDED',{resultHash:actionInputHash('result')})).toThrow();
  revision=j.transition(id,revision,'VERIFYING');expect(()=>j.transition(id,revision,'SUCCEEDED')).toThrow();
  revision=j.transition(id,revision,'SUCCEEDED',{resultHash:actionInputHash('result'),rollbackReference:'version_fixture'});
  expect(()=>j.transition(id,revision,'ROLLING_BACK',{resultHash:actionInputHash('replacement')})).toThrow();
  revision=j.transition(id,revision,'ROLLING_BACK');expect(()=>j.transition(id,revision,'UNDONE')).toThrow();j.transition(id,revision,'UNDONE',{resultHash:actionInputHash('undo result')});
  expect(j.get(id)?.result_hash).toBe(actionInputHash('result'));expect(j.get(id)?.undo_result_hash).toBe(actionInputHash('undo result'));
  expect(j.events(id).map(e=>e.state)).toEqual(['PREPARED','RUNNING','VERIFYING','SUCCEEDED','ROLLING_BACK','UNDONE']);
  expect(JSON.stringify(j.recent())).not.toContain('private note fixture');expect(JSON.stringify(j.recent())).not.toContain('private request fixture');
 }finally{db.close();}
});
test('duplicate callbacks and invalid transitions cannot rewrite action history',()=>{
 const db=openDatabase(':memory:');try{const j=new ActionJournal(db),id=j.prepare(plan);j.transition(id,0,'CANCELLED');expect(()=>j.transition(id,0,'RUNNING')).toThrow();expect(()=>j.transition(id,1,'RUNNING')).toThrow();expect(j.events(id)).toHaveLength(2);}finally{db.close();}
});
test('event-write failure rolls back the action transition',()=>{
 const db=openDatabase(':memory:');try{
  const j=new ActionJournal(db),id=j.prepare(plan);
  db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON action_events BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END;");
  expect(()=>j.transition(id,0,'RUNNING')).toThrow();expect(j.get(id)?.state).toBe('PREPARED');expect(j.events(id)).toHaveLength(1);
  expect(()=>j.prepare(plan)).toThrow();expect(j.recent()).toHaveLength(1);
 }finally{db.close();}
});
test('startup recovery marks unfinished work uncertain and never retries it',()=>{
 const db=openDatabase(':memory:');try{const j=new ActionJournal(db),id=j.prepare(plan);j.transition(id,0,'RUNNING');expect(j.recoverInterrupted()).toBe(1);expect(j.get(id)?.state).toBe('INTERRUPTED');expect(j.recoverInterrupted()).toBe(0);expect(()=>j.transition(id,2,'RUNNING')).toThrow();}finally{db.close();}
});
test('invalid evidence, unsupported permissions and unavailable undo fail closed',()=>{
 const db=openDatabase(':memory:');try{
  const j=new ActionJournal(db);expect(()=>j.prepare({...plan,rawRequest:'secret'} as any)).toThrow();expect(()=>j.prepare({...plan,risk:'RESTRICTED'})).toThrow();expect(()=>j.prepare({...plan,risk:'CONFIRM',permission:'policy'})).toThrow();
  const id=j.prepare(plan);j.transition(id,0,'RUNNING');j.transition(id,1,'VERIFYING');j.transition(id,2,'SUCCEEDED',{resultHash:actionInputHash('result')});expect(()=>j.transition(id,3,'ROLLING_BACK')).toThrow();expect(()=>j.recent(1000)).toThrow();
 }finally{db.close();}
});

test('existing diagnostic database migrates without losing history and action recovery survives restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'harmony-actions-'));
 try{
  const path=join(dir,'fixture.sqlite');const legacy=new DatabaseSync(path);
  legacy.exec("CREATE TABLE migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO migrations VALUES(1,'fixture'); CREATE TABLE journal(id INTEGER PRIMARY KEY,time TEXT NOT NULL,system TEXT NOT NULL,event TEXT NOT NULL,severity TEXT NOT NULL); INSERT INTO journal VALUES(1,'fixture','core','health.started','info');");legacy.close();
  let db=openDatabase(path);expect(db.prepare('SELECT event FROM journal').get()?.event).toBe('health.started');
  let journal=new ActionJournal(db);const id=journal.prepare(plan);journal.transition(id,0,'RUNNING');db.close();
  db=openDatabase(path);try{journal=new ActionJournal(db);expect(journal.recoverInterrupted()).toBe(1);expect(journal.get(id)?.state).toBe('INTERRUPTED');expect(journal.events(id)).toHaveLength(3);}finally{db.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
