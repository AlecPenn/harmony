import {test,expect} from 'vitest';
import {assessCalibration,type CalibrationTrial} from '../packages/identity/calibration.ts';
import type {SpeakerCalibration,SpeakerProfile} from '../packages/identity/contracts.ts';
const candidate:SpeakerCalibration={modelId:'fixture',dimensions:2,rejectBelow:.3,acceptAt:.85,minimumMargin:.1,calibratedAt:10,expiresAt:100};
const person=(id:string,vectors:number[][]):SpeakerProfile=>({id,displayName:id,role:'GUEST',modelId:'fixture',stableEmbeddings:vectors,trustedRecentEmbeddings:[],permissions:[],memoryNamespace:id,enrolledAt:1,lastCalibration:10,settings:{}});
const profiles=[person('a',[[1,0],[1,.01],[1,-.01]]),person('b',[[0,1],[.01,1],[-.01,1]])];
const trial=(sampleId:string,kind:CalibrationTrial['kind'],embedding:number[],expectedProfileId:string|null=null):CalibrationTrial=>({sampleId,kind,expectedProfileId,condition:'normal',evidence:{embedding,modelId:'fixture',quality:'sufficient',antiSpoof:'passed'}});
test('calibration reports false accepts, wrong-person matches and replay accepts without hiding failures',()=>{
 const report=assessCalibration(profiles,candidate,[trial('one','genuine',[1,.02],'a'),trial('two','genuine',[.02,1],'a'),trial('three','impostor',[1,.03]),trial('four','impostor',[-1,-1]),trial('five','replay',[.03,1])],20);
 expect(report.counts).toMatchObject({genuine:2,correct:1,wrongPerson:1,falseAccept:1,replayAccept:1});
 expect(report.falseAcceptRate).toBe(.5);expect(report.genuineFailureRate).toBe(.5);expect(report.replayAcceptRate).toBe(1);
 expect(report.coverage.allProfiles).toBe(false);expect(report.coverage.allConditions).toBe(false);
 expect(JSON.stringify(report)).not.toContain('embedding');expect(profiles[0].permissions).toEqual([]);
});
test('template reuse, duplicate trial ids, expired thresholds and foreign identities are invalid',()=>{
 const valid=trial('one','genuine',[1,.02],'a');
 for(const trials of [[trial('copy','genuine',[2,0],'a')],[valid,valid],[{...valid,expectedProfileId:'stranger'}],[trial('bad','impostor',[NaN,1])]])expect(()=>assessCalibration(profiles,candidate,trials,20)).toThrow();
 expect(()=>assessCalibration(profiles,candidate,[valid],100)).toThrow();
});
test('missing negative cohorts have null rates; unavailable anti-spoof is visible',()=>{
 const t=trial('one','genuine',[1,.02],'a');t.evidence.antiSpoof='unavailable';
 const report=assessCalibration(profiles,candidate,[t],20);
 expect(report.falseAcceptRate).toBeNull();expect(report.replayAcceptRate).toBeNull();expect(report.counts.unavailable).toBe(1);expect(report.counts.falseReject).toBe(1);
 expect(report.coverage.hasImpostors).toBe(false);
});

test('renaming a reused trial does not turn it into independent evaluation evidence',()=>{
 const t=trial('first','genuine',[1,.02],'a');
 expect(()=>assessCalibration(profiles,candidate,[t,{...t,sampleId:'renamed'}],20)).toThrow();
});
