import {measuredRoute} from '../packages/reasoning/measured-router.ts';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {test, expect} from 'vitest';
import {explainRoute,routeModel, type ModelCandidate, type ModelRouteRequest} from '../packages/reasoning/router.ts';
const request = (overrides: Partial<ModelRouteRequest> = {}): ModelRouteRequest => ({
  complexity:'routine', bigBrain:false, capabilities:['text'], inputTokens:100, maxOutputTokens:200,
  toolCount:0, risk:'safe', online:true, localOnly:false, nowMs:1000, maxHealthAgeMs:500,
  availableMemoryMiB:1024, remainingBudgetMicros:10000, maxFirstTokenMs:null, maxTurnMs:null, ...overrides,
});
const model = (overrides: Partial<ModelCandidate> = {}): ModelCandidate => ({
  id:'fixture-small', tier:'routine', location:'cloud', capabilities:['text'], ready:true, healthy:true,
  checkedAtMs:900, contextTokens:1000, maxOutputTokens:500, memoryMiB:0,
  requestCeilingMicros:100, firstTokenMs:50, expectedTurnMs:1000, ...overrides,
});
const big = model({id:'fixture-big', tier:'hardest'});
test('routine work cannot silently escalate to the hardest model', () => {
  expect(routeModel(request(), [big])).toMatchObject({modelId:null, requiredTier:'routine'});
  expect(routeModel(request(), [big, model()])).toMatchObject({modelId:'fixture-small', requiresCloudReview:true});
});
test('explicit big brain needs the hardest tier and sufficient known budget', () => {
  expect(routeModel(request({bigBrain:true}), [model(), big])).toMatchObject({modelId:'fixture-big'});
  expect(routeModel(request({bigBrain:true, remainingBudgetMicros:99}), [big])).toMatchObject({modelId:null});
  expect(routeModel(request({bigBrain:true}), [model()])).toMatchObject({modelId:null});
  expect(routeModel(request(), [model({requestCeilingMicros:null})])).toMatchObject({modelId:null});
});
test('risk and multi-tool work raise the required tier without granting authority', () => {
  expect(routeModel(request({risk:'high'}), [big])).toMatchObject({requiredTier:'hardest',requiresCloudReview:true});
  const complex=model({id:'fixture-complex',tier:'complex',capabilities:['text','tools']});
  expect(routeModel(request({toolCount:2,capabilities:['text','tools']}), [complex,big])).toMatchObject({modelId:'fixture-complex'});
  expect(routeModel(request({risk:'confirm'}), [model(),complex])).toMatchObject({requiredTier:'complex'});
  expect(()=>routeModel(request({toolCount:1}), [complex])).toThrow();
});
test('privacy, offline mode and resource limits fail closed', () => {
  expect(routeModel(request({localOnly:true}), [model()]).modelId).toBeNull();
  expect(routeModel(request({online:false}), [model()]).modelId).toBeNull();
  const local=model({id:'fixture-local',location:'local',memoryMiB:512,requestCeilingMicros:0});
  expect(routeModel(request({online:false,remainingBudgetMicros:0}), [local])).toMatchObject({modelId:local.id,requiresCloudReview:false});
  expect(routeModel(request({availableMemoryMiB:511}), [local]).modelId).toBeNull();
});
test('unknown, stale, future and failed health never routes a model', () => {
  for(const changes of [{ready:false},{healthy:false},{checkedAtMs:499},{checkedAtMs:1001}])
    expect(routeModel(request(), [model(changes)]).modelId).toBeNull();
  expect(routeModel(request(), [model({checkedAtMs:500})]).modelId).not.toBeNull();
});
test('capabilities and combined input/output context must fit', () => {
  expect(routeModel(request({capabilities:['vision']}), [model()]).modelId).toBeNull();
  expect(routeModel(request(), [model({contextTokens:299})]).modelId).toBeNull();
  expect(routeModel(request(), [model({contextTokens:300})]).modelId).not.toBeNull();
  expect(routeModel(request(), [model({maxOutputTokens:199})]).modelId).toBeNull();
});
test('selection is deterministic, budget first, unknown latency is not zero, inventory unchanged', () => {
  const unknown=model({id:'a',firstTokenMs:null}), measured=model({id:'b',firstTokenMs:10});
  const inventory=Object.freeze([Object.freeze(unknown),Object.freeze(measured)]);
  expect(routeModel(request(),inventory).modelId).toBe('b');
  expect(inventory[0].id).toBe('a');
  expect(routeModel(request(),[measured,model({id:'c',requestCeilingMicros:99,firstTokenMs:null})]).modelId).toBe('c');
  expect(routeModel(request(),[model({id:'z',firstTokenMs:null}),unknown]).modelId).toBe('a');
});
test('malformed request and inventory are rejected even when entries are disabled', () => {
  for(const changes of [{remainingBudgetMicros:NaN},{inputTokens:Number.MAX_SAFE_INTEGER}, {maxHealthAgeMs:0}, {toolCount:65}, {capabilities:['bogus'] as any}])
    expect(()=>routeModel(request(changes),[])).toThrow();
  for(const changes of [{id:'https://bad'}, {requestCeilingMicros:-1},{firstTokenMs:NaN},{capabilities:['text','text'] as any},{contextTokens:0}])
    expect(()=>routeModel(request(),[model({...changes,ready:false})])).toThrow();
  expect(()=>routeModel(request(),[model(),model()])).toThrow();
  expect(()=>routeModel(request(),Array.from({length:33},(_,i)=>model({id:`m${i}`})))).toThrow();
});


test('time limits exclude slow and unmeasured candidates without silent escalation',()=>{
 const constrained=request({maxFirstTokenMs:50,maxTurnMs:1000});
 expect(routeModel(constrained,[model()]).modelId).toBe('fixture-small');
 for(const change of [{firstTokenMs:51},{firstTokenMs:null},{expectedTurnMs:1001},{expectedTurnMs:null}])
  expect(routeModel(constrained,[model(change),big]).modelId).toBeNull();
 expect(routeModel(request(),[model({firstTokenMs:null,expectedTurnMs:null})]).modelId).not.toBeNull();
});
test('time constraints still honor privacy and cost and do not invent faster health evidence',()=>{
 const fast=model({id:'fast',firstTokenMs:5,expectedTurnMs:50,requestCeilingMicros:1000});
 expect(routeModel(request({maxTurnMs:50,remainingBudgetMicros:999}),[model(),fast]).modelId).toBeNull();
 expect(routeModel(request({maxTurnMs:50,localOnly:true}),[fast]).modelId).toBeNull();
 expect(routeModel(request({maxTurnMs:50}),[model({...fast,checkedAtMs:0})]).modelId).toBeNull();
});
test('invalid and internally contradictory duration evidence fails closed',()=>{
 for(const change of [{maxTurnMs:0},{maxTurnMs:NaN},{maxFirstTokenMs:-1},{maxFirstTokenMs:Infinity}])
  expect(()=>routeModel(request(change),[model()])).toThrow();
 for(const change of [{expectedTurnMs:-1},{expectedTurnMs:Infinity},{expectedTurnMs:49}])
  expect(()=>routeModel(request(),[model({...change,ready:false})])).toThrow();
});

test('routing records its own elapsed span without finishing the conversation',()=>{
 let tick=100;const profiler=new LatencyProfiler(()=>tick++);profiler.begin('conversation');
 expect(measuredRoute(request(),[model()],profiler).modelId).toBe('fixture-small');
 const trace=profiler.snapshot()!;expect(trace.state).toBe('pending');expect(trace.metrics.model_router_ms).toEqual({ms:1,state:'completed'});
 expect(trace.metrics.llm_first_token_ms.state).toBe('unavailable');expect(JSON.stringify(trace)).not.toContain('fixture-small');
});
test('routing failure records a failed stage, while no eligible model is a completed decision',()=>{
 let tick=0;const profiler=new LatencyProfiler(()=>tick++);profiler.begin('conversation');
 expect(()=>measuredRoute(request({maxTurnMs:-1}),[],profiler)).toThrow();expect(profiler.snapshot()!.metrics.model_router_ms.state).toBe('failed');
 expect(measuredRoute(request(),[],profiler).modelId).toBeNull();expect(profiler.snapshot()!.metrics.model_router_ms.state).toBe('completed');
 expect(profiler.snapshot()!.spans).toHaveLength(2);
});


test('routing diagnostics explain each failing constraint using the enforced selection rules',()=>{
 const cases:[Partial<ModelRouteRequest>,Partial<ModelCandidate>,string][]=[
  [{},{tier:'hardest'},'tier'],[{},{ready:false},'not_ready'],[{},{healthy:false},'unhealthy'],[{},{checkedAtMs:1},'stale_health'],
  [{capabilities:['vision']},{},'capability'],[{},{contextTokens:299},'context'],[{},{maxOutputTokens:199},'output_limit'],[{},{memoryMiB:2048},'memory'],
  [{maxFirstTokenMs:10},{firstTokenMs:null},'first_token_unknown'],[{maxFirstTokenMs:10},{},'first_token_limit'],[{maxTurnMs:100},{expectedTurnMs:null},'duration_unknown'],[{maxTurnMs:100},{},'duration_limit'],
  [{},{requestCeilingMicros:null},'cost_unknown'],[{remainingBudgetMicros:99},{},'budget'],[{online:false},{},'offline'],[{localOnly:true},{},'local_only']
 ];
 for(const [r,m,blocker] of cases){const req=request(r),models=[model(m)],decision=explainRoute(req,models);expect(decision.candidates[0].blockers).toContain(blocker);expect(decision.route).toEqual(routeModel(req,models));expect(decision.route.modelId).toBeNull();}
});
test('diagnostics report simultaneous blockers without granting authority or mutating inventory',()=>{
 const req=request({online:false,localOnly:true,remainingBudgetMicros:0}),models=[model({healthy:false})],before=structuredClone(models);
 const result=explainRoute(req,models);expect(result.candidates[0].blockers).toEqual(['unhealthy','budget','offline','local_only']);expect(models).toEqual(before);
 result.candidates[0].blockers.length=0;expect(routeModel(req,models).modelId).toBeNull();
 expect(explainRoute(request(),[model()]).candidates[0].blockers).toEqual([]);
 expect(()=>explainRoute(request(),[model({contextTokens:NaN})])).toThrow();
});
