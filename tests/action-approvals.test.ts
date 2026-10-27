import {test,expect} from 'vitest';
import {ApplicationEventBus} from '../core/application-events.ts';
import {PermissionPolicy,type ToolPolicy} from '../packages/permissions/policy.ts';
import {ActionApprovals} from '../packages/permissions/approvals.ts';
function fixture(){
 const bus=new ApplicationEventBus(),turn=bus.beginTurn();let now=100,identified=true;
 const tool:ToolPolicy={id:'calendar.change',version:1,risk:'CONFIRM',permissions:['calendar_write']};
 const people=[{id:'person',permissions:['calendar_write']}];let policy=new PermissionPolicy([tool],people,{denyTools:[],lowRiskWriteTools:[]});
 const approvals=new ActionApprovals(()=>policy,{isCurrent:t=>bus.isCurrent(t),identifies:person=>identified&&person==='person'},()=>now);
 const action={toolId:tool.id,personId:'person',inputs:{event:'fixture',time:'afternoon'}};
 return {bus,turn,tool,people,approvals,action,setTime:(v:number)=>{now=v;},setIdentity:(v:boolean)=>{identified=v;},setPolicy:(v:PermissionPolicy)=>{policy=v;}};
}
test('approval is single-use and returns immutable reviewed inputs',()=>{
 const f=fixture(),ticket=f.approvals.request(f.action,f.turn)!;expect(ticket).not.toBeNull();expect(f.approvals.approve(ticket)).toBe(true);
 const result=f.approvals.consume(ticket,f.action,f.turn)!;expect(result.action).toEqual(f.action);expect(Object.isFrozen(result.action.inputs)).toBe(true);
 expect(f.approvals.consume(ticket,f.action,f.turn)).toBeNull();
});
test('changed arguments, tools, people and copied tickets cannot reuse approval',()=>{
 for(const change of ['inputs','tool','person','ticket'] as const){
  const f=fixture(),ticket=f.approvals.request(f.action,f.turn)!;f.approvals.approve(ticket);const action=structuredClone(f.action);
  if(change==='inputs')action.inputs.time='morning';if(change==='tool')action.toolId='other';if(change==='person')action.personId='other';
  expect(f.approvals.consume(change==='ticket'?{...ticket}:ticket,action,f.turn)).toBeNull();
 }
});
test('STOP, identity revocation, expiry and policy changes invalidate pending approval',()=>{
 for(const change of ['stop','identity','expiry','policy','version'] as const){
  const f=fixture(),ticket=f.approvals.request(f.action,f.turn)!;f.approvals.approve(ticket);
  if(change==='stop')f.bus.cancelAll();if(change==='identity')f.setIdentity(false);if(change==='expiry')f.setTime(60100);
  if(change==='policy')f.setPolicy(new PermissionPolicy([f.tool],f.people,{denyTools:[f.tool.id],lowRiskWriteTools:[]}));
  if(change==='version')f.setPolicy(new PermissionPolicy([{...f.tool,version:2}],f.people,{denyTools:[],lowRiskWriteTools:[]}));
  expect(f.approvals.consume(ticket,f.action,f.turn)).toBeNull();
 }
});
test('unapproved or denied requests cannot execute; pending requests are bounded',()=>{
 const f=fixture(),ticket=f.approvals.request(f.action,f.turn)!;expect(f.approvals.consume(ticket,f.action,f.turn)).toBeNull();
 const denied=f.approvals.request(f.action,f.turn)!;f.approvals.deny(denied);expect(f.approvals.approve(denied)).toBe(false);
 for(let i=0;i<64;i++)expect(f.approvals.request(f.action,f.turn)).not.toBeNull();expect(f.approvals.request(f.action,f.turn)).toBeNull();
 f.approvals.cancelAll();expect(f.approvals.request(f.action,f.turn)).not.toBeNull();
});
