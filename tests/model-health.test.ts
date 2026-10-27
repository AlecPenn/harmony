import {test,expect} from 'vitest';
import {ModelHealth} from '../packages/reasoning/model-health.ts';
const id='gpt-6-astra',shape={inputTokens:10,maxOutputTokens:1024};
function fixture(){let now=0;const health=new ModelHealth(()=>now);return {health,time:(n:number)=>{now=n;},candidate:()=>health.candidate(id,shape,100)};}
test('models begin unverified and successful evidence expires without network probes',()=>{
 const f=fixture();expect(f.candidate()).toMatchObject({ready:false,healthy:false,firstTokenMs:null,expectedTurnMs:null});
 const t=f.health.begin(id,shape);f.time(20);f.health.firstText(t);f.time(50);f.health.finish(t,'completed');
 expect(f.candidate()).toMatchObject({healthy:true,checkedAtMs:50,firstTokenMs:20,expectedTurnMs:null});f.time(60051);expect(f.candidate().ready).toBe(false);
});
test('failures and cancellation invalidate evidence; older completions cannot revive it',()=>{
 for(const outcome of ['failed','cancelled'] as const){const f=fixture(),old=f.health.begin(id,shape),next=f.health.begin(id,shape);f.health.finish(next,outcome);f.health.finish(old,'completed');expect(f.candidate().healthy).toBe(false);}
});
test('attempt authority is object-identity based and cleared attempts cannot reappear',()=>{
 const f=fixture(),t=f.health.begin(id,shape);f.health.finish({...t},'completed');expect(f.candidate().ready).toBe(false);f.health.clear();f.health.finish(t,'completed');expect(f.candidate().ready).toBe(false);
});
test('timings bind to an immutable request shape and are never extrapolated as duration guarantees',()=>{
 const f=fixture(),input={...shape},t=f.health.begin(id,input);input.inputTokens=99;f.time(4);f.health.firstText(t);f.time(8);f.health.finish(t,'completed');
 expect(f.candidate().firstTokenMs).toBe(4);expect(f.health.candidate(id,input,100)).toMatchObject({healthy:true,firstTokenMs:null,expectedTurnMs:null});
});
test('clock rollback clears evidence and overlong attempts cannot establish health',()=>{
 const f=fixture(),t=f.health.begin(id,shape);f.time(120000);f.health.finish(t,'completed');expect(f.candidate().healthy).toBe(false);
 f.time(1);expect(()=>f.candidate()).toThrow();f.time(120001);expect(f.candidate().healthy).toBe(false);
});
test('attempt inventory is bounded and malformed models, shapes and costs are rejected',()=>{
 const f=fixture();for(let i=0;i<32;i++)f.health.begin(id,shape);expect(()=>f.health.begin(id,shape)).toThrow();f.time(120000);expect(()=>f.health.begin(id,shape)).not.toThrow();
 expect(()=>f.health.begin('unknown',shape)).toThrow();expect(()=>f.health.begin(id,{...shape,inputTokens:0})).toThrow();expect(()=>f.health.candidate(id,shape,NaN)).toThrow();
});
