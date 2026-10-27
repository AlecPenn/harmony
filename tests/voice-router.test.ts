import {test,expect} from 'vitest';
import {routeVoice,type VoiceCandidate,type VoiceRouteRequest} from '../packages/voice/router.ts';
const local:VoiceCandidate={id:'local.fixture',checkedAtMs:900,location:'local',ready:true,healthy:true,locale:'en-AU',gender:'female',firstAudioMs:400,quality:.7,costPerMillionCharacters:0,memoryMiB:512};
const cloud:VoiceCandidate={...local,id:'cloud.fixture',location:'cloud',firstAudioMs:100,quality:.9,costPerMillionCharacters:10,memoryMiB:0};
const request:VoiceRouteRequest={mode:'LOCAL_FIRST',nowMs:1000,maxHealthAgeMs:5000,locale:'en-AU',gender:'female',online:true,cloudApproved:false,maxCostPerMillionCharacters:10,availableMemoryMiB:1024};
test('local-first prefers a ready local voice even with cloud consent',()=>{expect(routeVoice({...request,cloudApproved:true},[cloud,local]).providerId).toBe(local.id);});
test('local failure never silently grants cloud consent',()=>{expect(routeVoice(request,[{...local,healthy:false},cloud]).providerId).toBeNull();expect(routeVoice({...request,cloudApproved:true},[cloud]).providerId).toBe(cloud.id);});
test('offline, network, budget and resource boundaries are enforced',()=>{for(const patch of [{mode:'OFFLINE' as const},{online:false},{maxCostPerMillionCharacters:0}])expect(routeVoice({...request,cloudApproved:true,...patch},[cloud]).providerId).toBeNull();expect(routeVoice({...request,availableMemoryMiB:1},[local]).providerId).toBeNull();});
test('voice identity is never replaced by an unrequested accent or gender',()=>{expect(routeVoice(request,[{...local,locale:'en-US'},{...cloud,gender:'male'}]).providerId).toBeNull();});
test('routing modes use measured latency and quality without pretending unknown timing is zero',()=>{expect(routeVoice({...request,mode:'FASTEST',cloudApproved:true},[local,cloud]).providerId).toBe(cloud.id);expect(routeVoice(request,[{...local,firstAudioMs:null}, {...local,id:'measured',firstAudioMs:900}]).providerId).toBe('measured');expect(routeVoice({...request,mode:'BEST_QUALITY',cloudApproved:true},[cloud,local]).providerId).toBe(cloud.id);expect(routeVoice({...request,mode:'CLOUD_PREMIUM'},[local]).providerId).toBeNull();});
test('invalid inventory and nonfinite limits fail closed',()=>{expect(()=>routeVoice(request,[local,local])).toThrow();expect(()=>routeVoice({...request,availableMemoryMiB:NaN},[local])).toThrow();expect(()=>routeVoice(request,[{...local,firstAudioMs:-1}])).toThrow();});


test('expired or future provider health cannot authorize routing or silently fall back to cloud',()=>{
 expect(routeVoice({...request,nowMs:5900},[local]).providerId).toBe(local.id);
 expect(routeVoice({...request,nowMs:5901},[local,cloud]).providerId).toBeNull();
 expect(routeVoice(request,[{...local,checkedAtMs:1001}]).providerId).toBeNull();
 expect(routeVoice(request,[{...local,checkedAtMs:0},{...cloud,checkedAtMs:1000}]).providerId).toBe(local.id);
 expect(routeVoice({...request,nowMs:6000},[local,{...cloud,checkedAtMs:6000}]).providerId).toBeNull();
 expect(routeVoice({...request,nowMs:6000,cloudApproved:true},[local,{...cloud,checkedAtMs:6000}]).providerId).toBe(cloud.id);
});

test('unbounded health windows and malformed consent or readiness fail closed',()=>{
 for(const patch of [{maxHealthAgeMs:0},{maxHealthAgeMs:60001},{nowMs:Infinity},{cloudApproved:'yes' as unknown as boolean},{online:1 as unknown as boolean}])expect(()=>routeVoice({...request,...patch},[local])).toThrow();
 for(const patch of [{checkedAtMs:NaN},{ready:'yes' as unknown as boolean},{healthy:1 as unknown as boolean}])expect(()=>routeVoice(request,[{...local,...patch}])).toThrow();
});
