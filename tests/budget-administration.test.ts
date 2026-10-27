import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
import {ApplicationEventBus} from '../core/application-events.ts';
import {BudgetAdministration,allowancePolicy,allowanceProposal} from '../core/budget-administration.ts';
import {ActionApprovals} from '../packages/permissions/approvals.ts';
import {PermissionPolicy} from '../packages/permissions/policy.ts';
const databases:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture(){
 const db=openDatabase(':memory:');databases.push(db);const budget=new ReasoningBudget(db),bus=new ApplicationEventBus(),turn=bus.beginTurn();let admin=true;
 const authority={isCurrent:(t:typeof turn)=>bus.isCurrent(t),identifies:(id:string)=>id==='owner',canManageBudget:(id:string,beneficiary:string)=>admin&&id==='owner'&&beneficiary==='child'};
 const policy=new PermissionPolicy([allowancePolicy],[{id:'owner',permissions:['manage_reasoning_budget']}],{denyTools:[],lowRiskWriteTools:[]});
 const approvals=new ActionApprovals(()=>policy,authority),runner=new BudgetAdministration(approvals,authority,budget);
 const proposal=allowanceProposal('owner',{budgetId:'child-first',beneficiaryId:'child',limitMicros:1000000}),ticket=approvals.request(proposal,turn)!;
 return {db,budget,bus,turn,approvals,runner,proposal,ticket,revoke:()=>{admin=false;}};
}
const plan={budgetId:'child-first',modelId:'fixture',estimateVersion:'v1',text:'Hello',personId:'child',turnId:'turn',inputTokens:10,maxOutputTokens:128,ceilingMicros:100};
test('explicit verified admin creates a person-bound allowance once',()=>{
 const f=fixture();f.approvals.approve(f.ticket);f.runner.create(f.ticket,f.proposal,f.turn);
 expect(f.budget.balance('child-first').remainingMicros).toBe(1000000);
 expect(f.db.prepare('SELECT person_id FROM reasoning_budgets').get()?.person_id).toBe('child');
 expect(()=>f.runner.create(f.ticket,f.proposal,f.turn)).toThrow();
 expect(()=>f.budget.reserve({...plan,personId:'other'})).toThrow();expect(()=>f.budget.reserve(plan)).not.toThrow();
});
test('unapproved, forged, changed, stopped and non-admin requests cannot create allowances',()=>{
 for(const change of ['unapproved','forged','amount','beneficiary','stop','admin']){
  const f=fixture();if(change!=='unapproved')f.approvals.approve(f.ticket);let ticket=f.ticket;
  if(change==='forged')ticket={...ticket};if(change==='amount')(f.proposal.inputs as any).limitMicros++;
  if(change==='beneficiary')(f.proposal.inputs as any).beneficiaryId='other';if(change==='stop')f.bus.cancelAll();if(change==='admin')f.revoke();
  expect(()=>f.runner.create(ticket,f.proposal,f.turn)).toThrow();expect(()=>f.budget.balance('child-first')).toThrow();
 }
});
test('admin cannot create an allowance for an unverified beneficiary',()=>{
 const f=fixture(),proposal=allowanceProposal('owner',{budgetId:'unknown',beneficiaryId:'unknown',limitMicros:100});
 const ticket=f.approvals.request(proposal,f.turn)!;f.approvals.approve(ticket);
 expect(()=>f.runner.create(ticket,proposal,f.turn)).toThrow('unavailable');expect(()=>f.budget.balance('unknown')).toThrow();
});
test('existing allowance cannot be reset, increased or transferred by reusing its id',()=>{
 const f=fixture();f.approvals.approve(f.ticket);f.runner.create(f.ticket,f.proposal,f.turn);
 const id=f.budget.reserve(plan);f.budget.dispatch(id,plan);f.budget.uncertain(id);
 f.budget.create('child-first',1000000,'child');expect(f.budget.balance('child-first').remainingMicros).toBe(999900);
 expect(()=>f.budget.create('child-first',1000001,'child')).toThrow();expect(()=>f.budget.create('child-first',1000000,'owner')).toThrow();
});
test('malformed currency amounts and accessor inputs are rejected before side effects',()=>{
 for(const value of [-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(()=>allowanceProposal('owner',{budgetId:'a',beneficiaryId:'child',limitMicros:value})).toThrow();
 let read=false;const input={budgetId:'a',beneficiaryId:'child',get limitMicros(){read=true;return 100;}};
 expect(()=>allowanceProposal('owner',input)).toThrow();expect(read).toBe(false);
});

function ownerFixture(){
 const db=openDatabase(':memory:');databases.push(db);const budget=new ReasoningBudget(db),bus=new ApplicationEventBus(),turn=bus.beginTurn();let admin=true;
 const authority={isCurrent:(t:typeof turn)=>bus.isCurrent(t),identifies:(id:string)=>id==='local_desktop',canManageBudget:()=>admin};
 const policy=new PermissionPolicy([allowancePolicy],[{id:'local_desktop',permissions:['manage_reasoning_budget']}],{denyTools:[],lowRiskWriteTools:[]});
 const approvals=new ActionApprovals(()=>policy,authority),proposal=allowanceProposal('local_desktop',{budgetId:'verified',beneficiaryId:'local_desktop',limitMicros:1000000});
 const ticket=approvals.request(proposal,turn)!;let calls=0,scope:unknown,accept=true;
 let complete!:(value:{kind:'owner-verification'})=>void;
 const owner={verify:async(value:unknown)=>{calls++;scope=value;return new Promise<{kind:'owner-verification'}>(resolve=>{complete=resolve;});},consume:()=>accept};
 const runner=new BudgetAdministration(approvals,authority,budget,owner),controller=new AbortController();
 return {budget,bus,turn,approvals,proposal,ticket,runner,controller,calls:()=>calls,scope:()=>scope,finish:()=>complete({kind:'owner-verification'}),reject:()=>{accept=false;},revoke:()=>{admin=false;}};
}
test('verified allowance binds the exact reviewed request and cannot use the synchronous bypass',async()=>{
 const f=ownerFixture();f.approvals.approve(f.ticket);
 expect(()=>f.runner.create(f.ticket,f.proposal,f.turn)).toThrow('Owner verification required');
 const task=f.runner.createVerified(f.ticket,f.proposal,f.turn,f.controller.signal);
 expect(f.scope()).toEqual({action:allowancePolicy.id,version:1,adminId:'local_desktop',turn:{id:f.turn.id,generation:f.turn.generation},allowance:{budgetId:'verified',beneficiaryId:'local_desktop',limitMicros:1000000}});
 (f.proposal.inputs as any).limitMicros=9000000;
 f.finish();await task;expect(f.budget.balance('verified').remainingMicros).toBe(1000000);
 await expect(f.runner.createVerified(f.ticket,f.proposal,f.turn,f.controller.signal)).rejects.toThrow();
 expect(f.calls()).toBe(1);
});
test('owner proof cannot rescue missing approval or create an allowance after STOP or revocation',async()=>{
 for(const mode of ['unapproved','aborted','stopped','revoked','invalid-proof']){
  const f=ownerFixture();if(mode!=='unapproved')f.approvals.approve(f.ticket);
  const task=f.runner.createVerified(f.ticket,f.proposal,f.turn,f.controller.signal);
  if(mode==='unapproved'){await expect(task).rejects.toThrow();expect(f.calls()).toBe(0);continue;}
  if(mode==='aborted')f.controller.abort();if(mode==='stopped')f.bus.cancelAll();if(mode==='revoked')f.revoke();if(mode==='invalid-proof')f.reject();
  f.finish();await expect(task).rejects.toThrow();expect(()=>f.budget.balance('verified')).toThrow();
 }
});
