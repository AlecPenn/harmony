import {routeModel,type ModelRouteRequest,type ModelCandidate} from './router.ts';
import type {LatencyProfiler} from '../telemetry/latency.ts';
/** Use the existing turn trace. Never records prompt, identity, key or inventory. */
export function measuredRoute(request:ModelRouteRequest,candidates:readonly ModelCandidate[],profiler:LatencyProfiler){
 const span=profiler.start('model_router_ms');
 try{const route=routeModel(request,candidates);profiler.end(span);return route;}
 catch(error){profiler.end(span,'failed');throw error;}
}
