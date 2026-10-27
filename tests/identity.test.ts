import {test,expect} from 'vitest';
import {evaluateSpeaker} from '../packages/identity/policy.ts';
import type {SpeakerCalibration,SpeakerEvidence,SpeakerProfile} from '../packages/identity/contracts.ts';
const calibration:SpeakerCalibration={modelId:'test-only',dimensions:2,rejectBelow:.3,acceptAt:.85,minimumMargin:.1,calibratedAt:10,expiresAt:100};
const profile=(id='person-a',samples=[[1,0],[1,.01],[1,-.01]]):SpeakerProfile=>({id,displayName:'Fixture',role:'OWNER',modelId:'test-only',stableEmbeddings:samples,trustedRecentEmbeddings:[],permissions:[],memoryNamespace:id,settings:{},enrolledAt:1,lastCalibration:10});
const evidence:SpeakerEvidence={embedding:[1,0],modelId:'test-only',quality:'sufficient',antiSpoof:'passed'};
test('identity has no default acceptance and fails closed on missing, expired or incompatible calibration',()=>{
  for(const c of [null,{...calibration,expiresAt:20},{...calibration,calibratedAt:21},{...calibration,acceptAt:NaN},{...calibration,rejectBelow:.9},{...calibration,minimumMargin:0},{...calibration,modelId:'other'}])expect(evaluateSpeaker(evidence,[profile()],c,20).state).toBe('REJECTED');
});
test('clear match yields evidence without permissions or a session; low and middle zones stay silent',()=>{
  expect(evaluateSpeaker(evidence,[profile()],calibration,20)).toMatchObject({state:'MATCH',profileId:'person-a'});
  expect(evaluateSpeaker({...evidence,embedding:[0,1]},[profile()],calibration,20)).toMatchObject({state:'REJECTED',profileId:null});
  expect(evaluateSpeaker({...evidence,embedding:[.7,.7]},[profile()],calibration,20)).toMatchObject({state:'UNCERTAIN',profileId:null});
});
test('replay-check absence, failed replay check, and insufficient speech cannot produce a match',()=>{
  for(const antiSpoof of ['unavailable','failed'] as const)expect(evaluateSpeaker({...evidence,antiSpoof},[profile()],calibration,20).state).toBe('REJECTED');
  expect(evaluateSpeaker({...evidence,quality:'insufficient'},[profile()],calibration,20).state).toBe('UNCERTAIN');
});
test('similar household voices and duplicate identifiers cannot select an arbitrary owner',()=>{
  expect(evaluateSpeaker(evidence,[profile(),profile('person-b')],calibration,20)).toMatchObject({state:'UNCERTAIN',profileId:null});
  expect(evaluateSpeaker(evidence,[profile(),profile()],calibration,20).state).toBe('REJECTED');
});
test('bad vectors, model mismatch, and stale profile calibration fail closed',()=>{
  for(const embedding of [[0,0],[NaN,0],[Infinity,1],[1],[1e100,0],[1e-300,0],Array(2)])expect(evaluateSpeaker({...evidence,embedding},[profile()],calibration,20).state).toBe('REJECTED');
  for(const p of [{...profile(),modelId:'wrong'},{...profile(),lastCalibration:9},profile('bad',[[1,0]])])expect(evaluateSpeaker(evidence,[p],calibration,20).state).toBe('REJECTED');
});
test('recent samples cannot silently replace stable enrollment, and inputs remain unchanged',()=>{
  const p={...profile(),trustedRecentEmbeddings:[[0,1],[0,1],[0,1]]};const before=structuredClone(p);
  expect(evaluateSpeaker({...evidence,embedding:[0,1]},[p],calibration,20).state).toBe('REJECTED');
  expect(p).toEqual(before);
  expect(evaluateSpeaker(evidence,[profile('outlier',[[1,0],[1,.01],[0,1]])],calibration,20).state).toBe('MATCH');
});
