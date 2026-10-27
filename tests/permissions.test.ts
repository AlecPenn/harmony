import {test,expect} from 'vitest';
import {PermissionPolicy,actionInputHash,type ToolPolicy} from '../packages/permissions/policy.ts';
const tools:ToolPolicy[]=[{id:'status.read',version:1,risk:'SAFE',permissions:['status_read']},{id:'notes.create',version:1,risk:'LOW_RISK_WRITE',permissions:['notes_write']},{id:'calendar.change',version:2,risk:'CONFIRM',permissions:['calendar_write']},{id:'credentials.export',version:1,risk:'RESTRICTED',permissions:['secrets']}];
const people=[{id:'owner',permissions:['status_read','notes_write','calendar_write','secrets']},{id:'child',permissions:['status_read']}];
const action=(toolId:string,personId='owner',inputs:unknown={})=>({toolId,personId,inputs});
test('risk comes from the trusted tool registry and person permissions apply to every risk tier',()=>{
 const p=new PermissionPolicy(tools,people,{denyTools:[],lowRiskWriteTools:[]});
 expect(p.evaluate(action('status.read')).state).toBe('ALLOWED');expect(p.evaluate(action('notes.create')).state).toBe('APPROVAL_REQUIRED');
 expect(p.evaluate({...action('calendar.change'),risk:'SAFE'} as any).state).toBe('APPROVAL_REQUIRED');
 expect(p.evaluate(action('notes.create','child'))).toEqual({state:'DENIED',reason:'permission'});
 expect(p.evaluate(action('status.read','unknown'))).toEqual({state:'DENIED',reason:'unknown_person'});
 expect(p.evaluate(action('shell.anything'))).toEqual({state:'DENIED',reason:'unknown_tool'});
});
test('denylist and restricted operations remain blocked even for owner and configured writes',()=>{
 const p=new PermissionPolicy(tools,people,{denyTools:['status.read'],lowRiskWriteTools:['notes.create','credentials.export','calendar.change']});
 expect(p.evaluate(action('status.read'))).toEqual({state:'DENIED',reason:'denylist'});
 expect(p.evaluate(action('credentials.export'))).toEqual({state:'DENIED',reason:'denylist'});
 expect(p.evaluate(action('notes.create')).state).toBe('ALLOWED');expect(p.evaluate(action('calendar.change')).state).toBe('APPROVAL_REQUIRED');
});
test('input hashes ignore object key order but bind actual values and types',()=>{
 expect(actionInputHash({b:2,a:1})).toBe(actionInputHash({a:1,b:2}));
 expect(actionInputHash({a:1})).not.toBe(actionInputHash({a:'1'}));expect(actionInputHash([1,2])).not.toBe(actionInputHash([2,1]));
});
test('input hashing rejects executable, unbounded and ambiguous objects without evaluating accessors',()=>{
 let invoked=false;const getter={get value(){invoked=true;return 1;}};
 const cyclic:any={};cyclic.self=cyclic;
 for(const bad of [getter,cyclic,NaN,undefined,new Date(),Array(2),JSON.parse('{"__proto__":1}'),{value:'x'.repeat(65537)},[()=>0]])expect(()=>actionInputHash(bad)).toThrow();
 expect(invoked).toBe(false);
});
test('registry and configuration snapshots cannot be mutated to grant permissions',()=>{
 const mutable=structuredClone(tools),settings={denyTools:[] as string[],lowRiskWriteTools:[] as string[]};
 const p=new PermissionPolicy(mutable,people,settings);mutable[2].risk='SAFE';settings.lowRiskWriteTools.push('notes.create');
 expect(p.evaluate(action('calendar.change')).state).toBe('APPROVAL_REQUIRED');expect(p.evaluate(action('notes.create')).state).toBe('APPROVAL_REQUIRED');
 expect(()=>new PermissionPolicy([...tools,tools[0]],people,settings)).toThrow();
 expect(()=>new PermissionPolicy([{...tools[0],permissions:[]}],people,settings)).toThrow();
});

test('array accessors are rejected without executing code during approval hashing',()=>{
 let invoked=false;const values=[1];Object.defineProperty(values,'0',{get(){invoked=true;return 1;},enumerable:true});
 expect(()=>actionInputHash(values)).toThrow();expect(invoked).toBe(false);
});

test('restricted actions outside the permanent denylist require an unavailable strong-auth adapter',()=>{
 const tool:ToolPolicy={id:'payments.submit',version:1,risk:'RESTRICTED',permissions:['secrets']};
 const policy=new PermissionPolicy([tool],people,{denyTools:[],lowRiskWriteTools:[tool.id]});
 expect(policy.evaluate(action(tool.id))).toEqual({state:'DENIED',reason:'restricted'});
});
