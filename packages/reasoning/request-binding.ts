import {actionInputHash} from '../permissions/policy.ts';
export interface BoundTextRequest {
 personId:string;turnId:string;budgetId:string;modelId:string;estimateVersion:string;
 text:string;inputTokens:number;maxOutputTokens:number;ceilingMicros:number;
}
/** Trusted core only. Bind the complete text-only plan; this never grants permission. */
export function reasoningRequestHash(request:BoundTextRequest):string {
 // Reject accessors, unsupported prototypes, cycles and oversized values before reading fields.
 const hash=actionInputHash({kind:'harmony.reasoning.text.v1',request});
 if(!request||Object.keys(request).sort().join(',')!=='budgetId,ceilingMicros,estimateVersion,inputTokens,maxOutputTokens,modelId,personId,text,turnId'
  ||![request.personId,request.turnId,request.budgetId,request.modelId,request.estimateVersion].every(v=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(v))
  ||typeof request.text!=='string'||!request.text.trim()||request.text.length>8000
  ||!Number.isSafeInteger(request.inputTokens)||request.inputTokens<1
  ||!Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<16||request.maxOutputTokens>4096
  ||request.inputTokens+request.maxOutputTokens>1050000
  ||!Number.isSafeInteger(request.ceilingMicros)||request.ceilingMicros<0)throw new Error('Invalid reasoning request binding');
 return hash;
}
