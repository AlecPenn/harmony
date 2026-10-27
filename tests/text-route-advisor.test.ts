import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReasoningBudget} from '../core/reasoning-budget.ts';
import {TextRouteAdvisor,type TextRouteRequirements} from '../core/text-route-advisor.ts';
import {ModelHealth} from '../packages/reasoning/model-health.ts';
import {catalogueReviewedAt,catalogueExpiresAt,estimateTextCeiling} from '../packages/reasoning/catalogue.ts';
import {reasoningRequestHash,type BoundTextRequest} from '../packages/reasoning/request-binding.ts';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
const requirements:TextRouteRequirements={complexity:'routine',bigBrain:false,risk:'safe',online:true,localOnly:false,maxFirstTokenMs:null,maxTurnMs:null};
function plan(modelId='gpt-6-luna',inputTokens=50):BoundTextRequest{
 return {personId:'person',turnId:'turn',budgetId:'budget',modelId,text:'Private fixture text',inputTokens,maxOutputTokens:100,
  ...estimateTextCeiling({modelId,inputTokens,maxOutputTokens:100,nowMs:catalogueReviewedAt,processing:'standard',region:'global',modality:'text',toolCount:0})};
}
function fixture(limit=1000000){
 const db=openDatabase(':memory:');dbs.push(db);const budget=new ReasoningBudget(db);budget.create('budget',limit,'person');
 let clock=100,wall=catalogueReviewedAt;const health=new ModelHealth(()=>clock),profiler=new LatencyProfiler(()=>clock);profiler.begin('reasoning');
 const advisor=new TextRouteAdvisor(budget,health,()=>wall,()=>clock);
 return {db,budget,health,profiler,advisor,advance:(ms:number)=>{clock+=ms;},expire:()=>{wall=catalogueExpiresAt;},
  ready:(p:BoundTextRequest)=>{const ticket=health.begin(p.modelId,p);clock+=10;health.firstText(ticket);clock+=20;health.finish(ticket,'completed');}};
}
test('advisor combines distinct model counts, prices, allowance and recent evidence without spending',()=>{
 const f=fixture(),small=plan(),large=plan('gpt-6-astra',300);f.ready(small);f.ready(large);
 const result=f.advisor.advise([large,small],requirements,f.profiler);
 expect(result).toMatchObject({route:{modelId:small.modelId,requiresCloudReview:true},requestHash:reasoningRequestHash(small)});
 expect(result.candidates[0].blockers).toContain('tier');expect(JSON.stringify(result)).not.toContain(small.text);
 expect(f.db.prepare('SELECT COUNT(*) AS n FROM reasoning_reservations').get()?.n).toBe(0);
 expect(f.profiler.snapshot()).toMatchObject({state:'pending',metrics:{model_router_ms:{state:'completed'}}});
});
test('unknown or expired health never selects; explicit deepest preference cannot fall back',()=>{
 const f=fixture(),p=plan();expect(f.advisor.advise([p],requirements,f.profiler).route.modelId).toBeNull();
 f.ready(p);expect(f.advisor.advise([p],{...requirements,bigBrain:true},f.profiler).route.modelId).toBeNull();
 f.advance(60001);expect(f.advisor.advise([p],requirements,f.profiler).route.modelId).toBeNull();
});
test('each model retains matching-shape first-text evidence and unknown duration fails closed',()=>{
 const f=fixture(),a=plan(),b=plan('gpt-6.1-sol',300);f.ready(a);f.ready(b);
 expect(f.advisor.advise([a,b],{...requirements,complexity:'complex',maxFirstTokenMs:15},f.profiler).route.modelId).toBe(b.modelId);
 expect(f.advisor.advise([a,plan(b.modelId,301)],{...requirements,complexity:'complex',maxFirstTokenMs:15},f.profiler).candidates[1].blockers).toContain('first_token_unknown');
 expect(f.advisor.advise([a],{...requirements,maxTurnMs:1000},f.profiler).candidates[0].blockers).toContain('duration_unknown');
});
test('current allowance spending and privacy affect advice without bypassing atomic dispatch',()=>{
 const p=plan(),f=fixture(p.ceilingMicros);f.ready(p);
 expect(f.advisor.advise([p],requirements,f.profiler).route.modelId).toBe(p.modelId);
 f.budget.reserve({...p,turnId:'other-turn'});
 expect(f.advisor.advise([p],requirements,f.profiler).candidates[0].blockers).toContain('budget');
 expect(f.advisor.advise([p],{...requirements,localOnly:true,online:false},f.profiler).candidates[0].blockers).toEqual(expect.arrayContaining(['local_only','offline']));
});
test('mixed people, budgets, turns, prompts, caps and duplicate models are rejected',()=>{
 const f=fixture(),a=plan(),b=plan('gpt-6-astra');
 for(const patch of [{personId:'other'},{budgetId:'other'},{turnId:'other'},{text:'different'},{maxOutputTokens:101},{modelId:a.modelId}])
  expect(()=>f.advisor.advise([a,{...b,...patch}],requirements,f.profiler)).toThrow();
 expect(()=>f.advisor.advise([{...a,personId:'other'}],requirements,f.profiler)).toThrow('does not belong');
 expect(()=>f.advisor.advise([],requirements,f.profiler)).toThrow();
});
test('stale prices and tampered plans fail with failed-stage telemetry and no reservation',()=>{
 const f=fixture(),p=plan();
 for(const patch of [{ceilingMicros:0},{estimateVersion:'fake'},{modelId:'unknown'}])expect(()=>f.advisor.advise([{...p,...patch}],requirements,f.profiler)).toThrow();
 f.expire();expect(()=>f.advisor.advise([p],requirements,f.profiler)).toThrow();
 expect(f.profiler.snapshot()?.metrics.model_router_ms.state).toBe('failed');
 expect(f.budget.balance('budget').committedMicros).toBe(0);
});

test('a recommendation cannot reserve funds or survive a later competing reservation',()=>{
 const f=fixture(plan().ceilingMicros),p=Object.freeze(plan()),plans=Object.freeze([p]);f.ready(p);
 const result=f.advisor.advise(plans,Object.freeze({...requirements}),f.profiler);
 expect(result.requestHash).toBe(reasoningRequestHash(p));
 const other=f.budget.reserve({...p,turnId:'competing-turn'});
 expect(()=>f.budget.reserve(p)).toThrow('exhausted');
 result.candidates[0].blockers.push('offline');
 expect(f.advisor.advise(plans,requirements,f.profiler).candidates[0].blockers).toEqual(['budget']);
 f.budget.release(other);expect(f.advisor.advise(plans,requirements,f.profiler).route.modelId).toBe(p.modelId);
});
