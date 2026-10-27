import type {LatencyTrace} from './latency.ts';
export interface ReasoningStatus {
 automatic:import('../reasoning/router.ts').ReasoningTier|null;
 routingTrace:LatencyTrace|null;
 modelId:import('../reasoning/text-contract.ts').TextModel;
 state:'IDLE'|'ESTIMATE_REVIEW'|'ESTIMATING'|'REVIEW'|'STREAMING'|'FINISHED'|'CANCELLED'|'ERROR';
 reviewId:string|null;
 prompt:string;
 text:string;
 refused:boolean;
 maxOutputTokens:1024;
 error:string|null;
 usage:{inputTokens:number;outputTokens:number}|null;
 trace:LatencyTrace|null;
 estimate:{inputTokens:number;ceilingMicros:number;estimateVersion:string}|null;
}
export const emptyReasoning:ReasoningStatus={automatic:null,routingTrace:null,modelId:'gpt-6-astra',state:'IDLE',reviewId:null,prompt:'',text:'',refused:false,maxOutputTokens:1024,error:null,usage:null,trace:null,estimate:null};
