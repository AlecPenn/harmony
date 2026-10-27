import type {SpeakerCalibration,SpeakerEvidence,SpeakerProfile} from './contracts.ts';
import {evaluateSpeaker,validCalibration} from './policy.ts';
import {validateProfiles} from './validate.ts';
import {enrollmentConditions,type EnrollmentCondition} from './enrollment.ts';
export interface CalibrationTrial {
  sampleId:string;
  kind:'genuine'|'impostor'|'replay';
  expectedProfileId:string|null;
  condition:EnrollmentCondition;
  evidence:SpeakerEvidence;
}
interface Counts {genuine:number;impostor:number;replay:number;correct:number;falseReject:number;wrongPerson:number;falseAccept:number;replayAccept:number;uncertain:number;unavailable:number;}
const empty=():Counts=>({genuine:0,impostor:0,replay:0,correct:0,falseReject:0,wrongPerson:0,falseAccept:0,replayAccept:0,uncertain:0,unavailable:0});
function fail():never{throw new Error('Invalid independent calibration trials');}
function validVector(v:readonly number[],dimensions:number){return Array.isArray(v)&&v.length===dimensions&&Array.from(v).every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e6)&&Math.hypot(...v)>1e-12;}
function sameDirection(a:readonly number[],b:readonly number[]){const an=Math.hypot(...a),bn=Math.hypot(...b);return a.every((v,i)=>Math.abs(v/an-b[i]/bn)<1e-10);}
/** Offline report only. Does not choose thresholds, update profiles or grant authorization. */
export function assessCalibration(profiles:readonly SpeakerProfile[],candidate:SpeakerCalibration,trials:readonly CalibrationTrial[],now:number){
  const clean=validateProfiles(profiles);
  if(!clean.length||!validCalibration(candidate,now)||!Array.isArray(trials)||trials.length<1||trials.length>10000||clean.some(p=>p.modelId!==candidate.modelId||p.lastCalibration!==candidate.calibratedAt||p.stableEmbeddings.some(v=>v.length!==candidate.dimensions)))fail();
  const ids=new Set(clean.map(p=>p.id)),seen=new Set<string>(),represented=new Set<string>(),conditions=new Map<EnrollmentCondition,Counts>();
  const observed:readonly number[][]=[];
  const total=empty(),knownVectors=clean.flatMap(p=>[...p.stableEmbeddings,...p.trustedRecentEmbeddings]);
  for(const trial of trials){
    if(!trial||typeof trial.sampleId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(trial.sampleId)||seen.has(trial.sampleId)||!['genuine','impostor','replay'].includes(trial.kind)||!enrollmentConditions.includes(trial.condition))fail();
    seen.add(trial.sampleId);
    if(trial.kind==='genuine'?(typeof trial.expectedProfileId!=='string'||!ids.has(trial.expectedProfileId)):trial.expectedProfileId!==null)fail();
    const e=trial.evidence;
    if(!e||e.modelId!==candidate.modelId||!validVector(e.embedding,candidate.dimensions)||!['sufficient','insufficient'].includes(e.quality)||!['passed','failed','unavailable'].includes(e.antiSpoof))fail();
    // Detect exact/rescaled template reuse. Independent recording provenance still requires review.
    if([...knownVectors,...observed].some(v=>sameDirection(v,e.embedding)))fail();
    (observed as number[][]).push([...e.embedding]);
    if(trial.kind==='genuine')represented.add(trial.expectedProfileId!);
    const result=evaluateSpeaker(e,clean,candidate,now),group=conditions.get(trial.condition)??empty();conditions.set(trial.condition,group);
    for(const count of [total,group]){
      count[trial.kind as CalibrationTrial['kind']]++;
      if(result.state==='UNCERTAIN')count.uncertain++;
      if(e.antiSpoof==='unavailable'||(result.state==='REJECTED'&&result.reason==='unavailable'))count.unavailable++;
      if(trial.kind==='genuine'){
        if(result.state==='MATCH'&&result.profileId===trial.expectedProfileId)count.correct++;
        else if(result.state==='MATCH')count.wrongPerson++;
        else count.falseReject++;
      }else if(result.state==='MATCH'){
        if(trial.kind==='impostor')count.falseAccept++;else count.replayAccept++;
      }
    }
  }
  return {counts:total,falseAcceptRate:total.impostor?total.falseAccept/total.impostor:null,
    genuineFailureRate:total.genuine?(total.falseReject+total.wrongPerson)/total.genuine:null,
    replayAcceptRate:total.replay?total.replayAccept/total.replay:null,
    coverage:{allProfiles:represented.size===clean.length,allConditions:conditions.size===enrollmentConditions.length,hasImpostors:total.impostor>0,hasReplays:total.replay>0},
    conditions:enrollmentConditions.filter(condition=>conditions.has(condition)).map(condition=>({condition,counts:conditions.get(condition)!}))};
}
