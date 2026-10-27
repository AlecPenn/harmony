import {test,expect} from 'vitest';
import {reasoningRequestHash,type BoundTextRequest} from '../packages/reasoning/request-binding.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
import {openDatabase} from '../core/storage.ts';
const request:BoundTextRequest={personId:'person',turnId:'turn',budgetId:'budget',modelId:'fixture-model',estimateVersion:'v1',text:'Private text',inputTokens:30,maxOutputTokens:1024,ceilingMicros:100};
test('every execution field binds a distinct request while key order does not matter',()=>{
 const hash=reasoningRequestHash(request);
 expect(reasoningRequestHash(Object.fromEntries(Object.entries(request).reverse()) as unknown as BoundTextRequest)).toBe(hash);
 for(const [key,value] of Object.entries(request))
  expect(reasoningRequestHash({...request,[key]:typeof value==='string'?value+'x':value+1})).not.toBe(hash);
 expect(hash).toMatch(/^[a-f0-9]{64}$/);
});
test('malformed plans and getter side effects are rejected',()=>{
 for(const patch of [{text:''},{text:'x'.repeat(8001)},{inputTokens:NaN},{inputTokens:1050000},{maxOutputTokens:4097},{ceilingMicros:-1},{endpoint:'https://elsewhere.test'}])
  expect(()=>reasoningRequestHash({...request,...patch})).toThrow();
 let accessed=false;const accessor={...request};Object.defineProperty(accessor,'text',{get(){accessed=true;return 'secret';},enumerable:true});
 expect(()=>reasoningRequestHash(accessor)).toThrow();expect(accessed).toBe(false);
});
test('durable dispatch requires the same complete plan and persists no raw prompt',()=>{
 const db=openDatabase(':memory:');try{
  const budget=new ReasoningBudget(db);budget.create('budget',1000,'person');
  const hash=reasoningRequestHash(request);
  const id=budget.reserve(request);
  for(const patch of [{text:'Replacement'},{personId:'other'},{modelId:'other'},{turnId:'other'},{ceilingMicros:200}])
   expect(()=>budget.dispatch(id,{...request,...patch})).toThrow();
  budget.dispatch(id,request);
  const row=db.prepare('SELECT * FROM reasoning_reservations WHERE id=?').get(id);
  expect(row?.state).toBe('DISPATCHED');expect(JSON.stringify(row)).not.toContain('Private text');
  expect(()=>budget.dispatch(id,request)).toThrow();
 }finally{db.close();}
});
