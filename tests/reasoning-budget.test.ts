import {test,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../core/storage.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
const reservation={budgetId:'fixture',modelId:'fixture-model',estimateVersion:'fixture-prices-v1',ceilingMicros:60,personId:'person',turnId:'turn',text:'Private request',inputTokens:30,maxOutputTokens:1024};
test('reservations atomically consume allowance and cannot be released after dispatch',()=>{
  const db=openDatabase(':memory:');try {
    const budget=new ReasoningBudget(db);budget.create('fixture',100,'person');const id=budget.reserve(reservation);
    expect(budget.balance('fixture').remainingMicros).toBe(40);expect(()=>budget.reserve(reservation)).toThrow();
    budget.dispatch(id,reservation);expect(()=>budget.release(id)).toThrow();expect(()=>budget.dispatch(id,reservation)).toThrow();
    budget.settle(id,20);expect(budget.balance('fixture').remainingMicros).toBe(80);
    expect(()=>budget.settle(id,0)).toThrow();
  }finally{db.close();}
});
test('cancellation before dispatch frees funds once; uncertain requests retain their ceiling',()=>{
  const db=openDatabase(':memory:');try{
    const budget=new ReasoningBudget(db);budget.create('fixture',100,'person');const id=budget.reserve(reservation);
    budget.release(id);expect(()=>budget.release(id)).toThrow();expect(()=>budget.dispatch(id,reservation)).toThrow();
    expect(budget.balance('fixture').remainingMicros).toBe(100);
    const next=budget.reserve(reservation);budget.dispatch(next,reservation);budget.uncertain(next);
    expect(()=>budget.release(next)).toThrow();expect(budget.balance('fixture').remainingMicros).toBe(40);
    budget.settle(next,35);expect(budget.balance('fixture').remainingMicros).toBe(65);
  }finally{db.close();}
});
test('provider overrun is recorded honestly and blocks even zero-cost new reservations',()=>{
  const db=openDatabase(':memory:');try{
    const budget=new ReasoningBudget(db);budget.create('fixture',100,'person');const id=budget.reserve(reservation);budget.dispatch(id,reservation);budget.settle(id,120);
    expect(budget.balance('fixture')).toEqual({limitMicros:100,committedMicros:120,remainingMicros:0});
    expect(()=>budget.reserve({...reservation,ceilingMicros:0})).toThrow();
    expect(()=>budget.create('fixture',200,'person')).toThrow();budget.create('fixture',100,'person');
  }finally{db.close();}
});
test('multiple database connections cannot spend the same allowance and restart retains uncertainty',()=>{
  const dir=mkdtempSync(join(tmpdir(),'harmony-budget-')),path=join(dir,'budget.sqlite');
  let db=openDatabase(path),other=openDatabase(path);
  try{
    let budget=new ReasoningBudget(db);budget.create('fixture',100,'person');
    const id=budget.reserve(reservation);budget.dispatch(id,reservation);
    const second=new ReasoningBudget(other);expect(()=>second.reserve(reservation)).toThrow();
    second.reserve({...reservation,ceilingMicros:30});other.close();db.close();
    db=openDatabase(path);other=openDatabase(path);budget=new ReasoningBudget(db);budget.recover();budget.recover();
    expect(budget.balance('fixture').remainingMicros).toBe(40);expect(()=>budget.release(id)).toThrow();
    budget.settle(id,10);expect(budget.balance('fixture').remainingMicros).toBe(90);
  }finally{other.close();db.close();rmSync(dir,{recursive:true,force:true});}
},20000);
test('failed durable transitions leave reservations intact and dispatch unavailable',()=>{
  const db=openDatabase(':memory:');try{
    const budget=new ReasoningBudget(db);budget.create('fixture',100,'person');const id=budget.reserve(reservation);
    db.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON reasoning_reservations BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END;");
    expect(()=>budget.dispatch(id,reservation)).toThrow();expect(budget.balance('fixture').remainingMicros).toBe(40);
    expect(db.prepare('SELECT state FROM reasoning_reservations WHERE id=?').get(id)?.state).toBe('RESERVED');
  }finally{db.close();}
});
test('invalid metadata, unknown budgets and excessive unresolved work fail closed',()=>{
  const db=openDatabase(':memory:');try{
    const budget=new ReasoningBudget(db);expect(()=>budget.reserve(reservation)).toThrow();budget.create('fixture',100,'person');
    for(const changes of [{ceilingMicros:NaN},{ceilingMicros:-1},{rawPrompt:'private'},{modelId:'bad/path'}])
      expect(()=>budget.reserve({...reservation,...changes})).toThrow();
    expect(()=>budget.settle('missing',0)).toThrow();expect(()=>budget.create('bad/path',10,'person')).toThrow();
    for(let i=0;i<128;i++)budget.reserve({...reservation,ceilingMicros:0});
    expect(()=>budget.reserve({...reservation,ceilingMicros:0})).toThrow();
  }finally{db.close();}
});

test('changed request cannot dispatch a reservation and legacy unbound rows stay blocked',()=>{
 const db=openDatabase(':memory:');try{
  const budget=new ReasoningBudget(db);budget.create('fixture',100,'person');const id=budget.reserve(reservation);
  expect(()=>budget.dispatch(id,{...reservation,text:'changed'})).toThrow();
  expect(db.prepare('SELECT state FROM reasoning_reservations WHERE id=?').get(id)?.state).toBe('RESERVED');
  expect(budget.balance('fixture').remainingMicros).toBe(40);
  db.prepare('UPDATE reasoning_reservations SET request_hash=NULL WHERE id=?').run(id);
  expect(()=>budget.dispatch(id,reservation)).toThrow();
  budget.recover();expect(budget.balance('fixture').remainingMicros).toBe(100);
 }finally{db.close();}
});

test('version-three budget rows survive migration without gaining dispatch authority',()=>{
 const dir=mkdtempSync(join(tmpdir(),'harmony-budget-migrate-')),path=join(dir,'budget.sqlite');
 let db=openDatabase(path);
 try{
  let budget=new ReasoningBudget(db);budget.create('fixture',100,'person');
  const pending=budget.reserve({...reservation,ceilingMicros:30});
  const sent=budget.reserve({...reservation,ceilingMicros:40});budget.dispatch(sent,{...reservation,ceilingMicros:40});
  // Reconstruct the exact prior reservation schema and its migration marker.
  db.exec('DROP TABLE speed_turns; DROP TABLE work_files; DROP TABLE work_events; DROP TABLE work_jobs; DROP TABLE guard_events; DROP TABLE missions; DROP TABLE ideas; DROP TABLE workspace_snapshots; DROP TABLE memory_settings; DROP TABLE embeddings; DROP TABLE episodes; DROP TABLE project_state; DROP TABLE project_notes; DROP TABLE projects; DROP TABLE web_lookups; DROP TABLE memories; DROP TABLE reminders; ALTER TABLE reasoning_reservations DROP COLUMN request_hash; ALTER TABLE reasoning_budgets DROP COLUMN person_id; DELETE FROM migrations WHERE version>=4;');
  db.close();db=openDatabase(path);budget=new ReasoningBudget(db);
  expect(budget.balance('fixture').remainingMicros).toBe(30);
  expect(()=>budget.dispatch(pending,{...reservation,ceilingMicros:30})).toThrow();
  budget.recover();expect(budget.balance('fixture').remainingMicros).toBe(60);
  expect(db.prepare('SELECT state FROM reasoning_reservations WHERE id=?').get(sent)?.state).toBe('UNCERTAIN');
  budget.settle(sent,25);expect(budget.balance('fixture').remainingMicros).toBe(75);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
},20000);


test('version-four budgets retain balances but cannot gain a person through migration',()=>{
 const dir=mkdtempSync(join(tmpdir(),'harmony-owner-migrate-')),path=join(dir,'budget.sqlite');let db=openDatabase(path);
 try{
  let budget=new ReasoningBudget(db);budget.create('fixture',100,'person');
  const pending=budget.reserve({...reservation,ceilingMicros:30});const sent=budget.reserve({...reservation,ceilingMicros:40});budget.dispatch(sent,{...reservation,ceilingMicros:40});
  db.exec('DROP TABLE speed_turns; DROP TABLE work_files; DROP TABLE work_events; DROP TABLE work_jobs; DROP TABLE guard_events; DROP TABLE missions; DROP TABLE ideas; DROP TABLE workspace_snapshots; DROP TABLE memory_settings; DROP TABLE embeddings; DROP TABLE episodes; DROP TABLE project_state; DROP TABLE project_notes; DROP TABLE projects; DROP TABLE web_lookups; DROP TABLE memories; DROP TABLE reminders; ALTER TABLE reasoning_budgets DROP COLUMN person_id; DELETE FROM migrations WHERE version>=5;');db.close();db=openDatabase(path);budget=new ReasoningBudget(db);
  expect(budget.balance('fixture').remainingMicros).toBe(30);expect(()=>budget.create('fixture',100,'person')).toThrow();
  expect(()=>budget.reserve({...reservation,ceilingMicros:0})).toThrow();expect(()=>budget.dispatch(pending,{...reservation,ceilingMicros:30})).toThrow();
  budget.recover();expect(budget.balance('fixture').remainingMicros).toBe(60);budget.settle(sent,25);expect(budget.balance('fixture').remainingMicros).toBe(75);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});


test('breakdown distinguishes unsent holds, possible sends and settled charges without leaking request data',()=>{
 const db=openDatabase(':memory:');try{
  const b=new ReasoningBudget(db);b.create('fixture',1000,'person');b.create('other',500,'other');
  const waiting=b.reserve(reservation),sent=b.reserve(reservation),uncertain=b.reserve(reservation),settled=b.reserve(reservation),released=b.reserve(reservation);
  b.dispatch(sent,reservation);b.dispatch(uncertain,reservation);b.uncertain(uncertain);b.dispatch(settled,reservation);b.settle(settled,25);b.release(released);
  expect(b.breakdown('fixture')).toEqual({limitMicros:1000,committedMicros:205,remainingMicros:795,waitingMicros:60,uncertainMicros:120,settledMicros:25,unresolvedCount:2});
  expect(b.breakdown('other')).toEqual({limitMicros:500,committedMicros:0,remainingMicros:500,waitingMicros:0,uncertainMicros:0,settledMicros:0,unresolvedCount:0});
  b.recover();expect(b.breakdown('fixture')).toMatchObject({waitingMicros:0,uncertainMicros:120,settledMicros:25,remainingMicros:855,unresolvedCount:2});
  expect(()=>b.release(waiting)).toThrow();expect(JSON.stringify(b.breakdown('fixture'))).not.toContain(reservation.text);
 }finally{db.close();}
});
test('breakdown rejects missing budgets and unsafe combined totals',()=>{
 const db=openDatabase(':memory:');try{
  const b=new ReasoningBudget(db);expect(()=>b.breakdown('missing')).toThrow();b.create('fixture',Number.MAX_SAFE_INTEGER,'person');
  const a=b.reserve(reservation),c=b.reserve(reservation);b.dispatch(a,reservation);b.dispatch(c,reservation);
  b.settle(a,Number.MAX_SAFE_INTEGER);b.settle(c,1);expect(()=>b.breakdown('fixture')).toThrow();expect(()=>b.balance('fixture')).toThrow();
 }finally{db.close();}
});


test('history is bounded, newest-created first, budget-scoped and excludes private request fields',()=>{
 const db=openDatabase(':memory:');try{
  const b=new ReasoningBudget(db);b.create('fixture',10000,'person');b.create('other',10000,'other');const ids:string[]=[];
  for(let i=0;i<25;i++){const id=b.reserve(reservation);ids.push(id);b.release(id);}
  b.reserve({...reservation,budgetId:'other',personId:'other'});
  const history=b.recent('fixture');expect(history).toHaveLength(20);expect(history.map(x=>x.reference)).toEqual(ids.slice(-20).reverse());
  expect(Object.keys(history[0]).sort()).toEqual(['actualMicros','ceilingMicros','model','reference','state']);
  expect(history[0]).toMatchObject({state:'RELEASED',actualMicros:null,ceilingMicros:60});expect(JSON.stringify(history)).not.toContain(reservation.text);
  for(const limit of [0,21,1.5,NaN])expect(()=>b.recent('fixture',limit)).toThrow();
  const id=b.reserve(reservation);b.dispatch(id,reservation);b.settle(id,25);expect(b.recent('fixture',1)[0]).toMatchObject({reference:id,state:'SETTLED',actualMicros:25});
 }finally{db.close();}
});
