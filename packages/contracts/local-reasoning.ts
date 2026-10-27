import type {LatencyTrace} from './latency.ts';
export type LocalModelState='NOT_INSTALLED'|'OFF'|'STARTING'|'READY'|'STOPPING'|'FAILED';
export interface LocalModelStatus {state:LocalModelState;modelId:string|null;modelName:string|null;loadMs:number|null;}
export interface LocalReasoningStatus {
 state:'IDLE'|'STARTING'|'STREAMING'|'FINISHED'|'CANCELLED'|'ERROR';
 prompt:string;
 text:string;
 truncated:boolean;
 error:string|null;
 usage:{inputTokens:number;outputTokens:number}|null;
 /** Real model load time when this request had to start the model; null when it was already loaded. */
 coldStartMs:number|null;
 trace:LatencyTrace|null;
 model:LocalModelStatus;
 /** Where web information in this answer came from. */
 sources:{title:string;url:string;site:string}[];
}
export const emptyLocalReasoning:LocalReasoningStatus={state:'IDLE',prompt:'',text:'',truncated:false,error:null,usage:null,coldStartMs:null,trace:null,sources:[],
 model:{state:'NOT_INSTALLED',modelId:null,modelName:null,loadMs:null}};
