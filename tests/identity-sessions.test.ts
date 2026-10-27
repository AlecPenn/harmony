import {test,expect} from 'vitest';
import {ApplicationEventBus} from '../core/application-events.ts';
import {HouseholdSessions} from '../packages/identity/sessions.ts';
import type {SpeakerProfile,SpeakerCalibration,SpeakerEvidence} from '../packages/identity/contracts.ts';
function fixture(){
 const bus=new ApplicationEventBus(),turn=bus.beginTurn();let now=100;
 const profile:SpeakerProfile={id:'fixture_person',displayName:'Fixture',role:'GUEST',modelId:'fixture',stableEmbeddings:[[1,0],[1,.01],[1,-.01]],trustedRecentEmbeddings:[],permissions:['fixture_permission'],memoryNamespace:'private_fixture',settings:{},enrolledAt:1,lastCalibration:10};
 const calibration:SpeakerCalibration={modelId:'fixture',dimensions:2,rejectBelow:.3,acceptAt:.85,minimumMargin:.1,calibratedAt:10,expiresAt:100000};
 const directory={read:async()=>({profiles:[profile],calibration})};
 const sessions=new HouseholdSessions(directory,bus,()=>now);
 const evidence:SpeakerEvidence={embedding:[1,.02],modelId:'fixture',quality:'sufficient',antiSpoof:'passed'};
 return {bus,turn,profile,calibration,directory,sessions,evidence,setTime:(value:number)=>{now=value;}};
}
test('trusted current turn receives identity context without action permissions or biometric data',async()=>{
 const f=fixture(),handle=await f.sessions.bind(f.turn,'desktop',f.evidence);expect(handle).not.toBeNull();
 const context=await f.sessions.resolve(handle!,f.turn,'desktop');
 expect(context).toEqual({profileId:'fixture_person',memoryNamespace:'private_fixture',role:'GUEST',expiresAt:60100});
 expect(Object.keys(handle!)).toEqual(['kind']);expect(JSON.stringify(context)).not.toContain('permission');
 expect(await f.sessions.resolve({...handle!},f.turn,'desktop')).toBeNull();
});
test('unknown, uncertain, uncalibrated and replay-unchecked voices receive no session',async()=>{
 const f=fixture();
 for(const evidence of [{...f.evidence,embedding:[-1,0]},{...f.evidence,embedding:[.7,.7]},{...f.evidence,antiSpoof:'unavailable' as const},{...f.evidence,quality:'insufficient' as const}])expect(await f.sessions.bind(f.turn,'desktop',evidence)).toBeNull();
 f.profile.lastCalibration=0;expect(await f.sessions.bind(f.turn,'desktop',f.evidence)).toBeNull();
});
test('turn copies, different devices, ended turns and STOP cannot reuse identity',async()=>{
 const f=fixture();expect(await f.sessions.bind({...f.turn},'desktop',f.evidence)).toBeNull();
 const handle=await f.sessions.bind(f.turn,'desktop',f.evidence);expect(await f.sessions.resolve(handle!,f.turn,'another_device')).toBeNull();
 const next=await f.sessions.bind(f.turn,'desktop',f.evidence);f.bus.cancelAll();expect(await f.sessions.resolve(next!,f.turn,'desktop')).toBeNull();
 const turn=f.bus.beginTurn(),third=await f.sessions.bind(turn,'desktop',f.evidence);f.bus.endTurn(turn);expect(await f.sessions.resolve(third!,turn,'desktop')).toBeNull();
});
test('STOP and profile revocation while the directory is loading reject late grants',async()=>{
 for(const cancel of ['stop','profile'] as const){
  const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),read=f.directory.read;
  f.directory.read=async()=>{await gate;return read();};const pending=f.sessions.bind(f.turn,'desktop',f.evidence);
  if(cancel==='stop')f.bus.cancelAll();else f.sessions.revokeProfile(f.profile.id);release();expect(await pending).toBeNull();
 }
});
test('profile edits, expiry and backwards clock invalidate cached identity',async()=>{
 for(const change of ['profile','expiry','clock'] as const){
  const f=fixture(),handle=await f.sessions.bind(f.turn,'desktop',f.evidence);
  if(change==='profile')f.profile.permissions=[];else f.setTime(change==='expiry'?60100:99);
  expect(await f.sessions.resolve(handle!,f.turn,'desktop')).toBeNull();
 }
});
test('a delayed resolve cannot resurrect an explicitly revoked identity',async()=>{
 const f=fixture(),handle=await f.sessions.bind(f.turn,'desktop',f.evidence);let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),read=f.directory.read;
 f.directory.read=async()=>{await gate;return read();};const pending=f.sessions.resolve(handle!,f.turn,'desktop');f.sessions.revokeAll();release();expect(await pending).toBeNull();
});

test('a new unknown speaker invalidates the earlier identity on the same turn and device',async()=>{
 const f=fixture(),handle=await f.sessions.bind(f.turn,'desktop',f.evidence);
 expect(await f.sessions.bind(f.turn,'desktop',{...f.evidence,antiSpoof:'unavailable'})).toBeNull();
 expect(await f.sessions.resolve(handle!,f.turn,'desktop')).toBeNull();
});
test('an older delayed match cannot override a newer unknown-speaker result',async()=>{
 const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),read=f.directory.read;let calls=0;
 f.directory.read=async()=>{if(++calls===1)await gate;return read();};
 const first=f.sessions.bind(f.turn,'desktop',f.evidence);
 expect(await f.sessions.bind(f.turn,'desktop',{...f.evidence,antiSpoof:'failed'})).toBeNull();
 release();expect(await first).toBeNull();
});
test('pending bindings are bounded and too-slow evidence cannot establish a session',async()=>{
 const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),read=f.directory.read;
 f.directory.read=async()=>{await gate;return read();};
 const pending=Array.from({length:16},(_,i)=>f.sessions.bind(f.turn,'device_'+i,f.evidence));
 expect(await f.sessions.bind(f.turn,'extra_device',f.evidence)).toBeNull();
 f.setTime(10101);release();expect(await Promise.all(pending)).toEqual(Array(16).fill(null));
});
