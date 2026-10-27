import type {ReasoningTier} from './router.ts';
/** Reviewed official text pricing. Documentation is not evidence of account access or health. */
export const catalogueVersion='openai-text-standard-2026-10-14';
export const catalogueReviewedAt=Date.parse('2026-10-14T00:00:00Z');
export const catalogueExpiresAt=Date.parse('2026-10-21T00:00:00Z');
const entry=(id:string,tier:ReasoningTier,inputMicrosPerThousand:number,outputMicrosPerThousand:number)=>Object.freeze({
 id,tier,contextTokens:1050000,maxOutputTokens:128000,
 // Input uses the higher cache-write rate, with no assumed cache discount.
 inputMicrosPerThousand,outputMicrosPerThousand,
 source:`https://developers.openai.com/api/docs/models/${id}`,
});
export const reasoningCatalogue=Object.freeze([
 entry('gpt-6-luna','routine',125,500),
 entry('gpt-6.1-sol','complex',2500,10000),
 entry('gpt-6-astra','hardest',12500,50000),
]);
export interface TextCostRequest {
 modelId:string;
 /** Complete validated token count, including instructions and message framing. Not characters. */
 inputTokens:number;
 maxOutputTokens:number;
 nowMs:number;
 processing:'standard';
 region:'global';
 modality:'text';
 toolCount:0;
}
/** Conservative text-only estimate, not an invoice, permission or account capability probe. */
export function estimateTextCeiling(request:TextCostRequest):{ceilingMicros:number;estimateVersion:string} {
 if(!request||Object.keys(request).sort().join(',')!=='inputTokens,maxOutputTokens,modality,modelId,nowMs,processing,region,toolCount')throw new Error('Text price estimate unavailable');
 const model=reasoningCatalogue.find(model=>model.id===request.modelId);
 if(!model||!Number.isSafeInteger(request.nowMs)||request.nowMs<catalogueReviewedAt||request.nowMs>=catalogueExpiresAt
   ||request.processing!=='standard'||request.region!=='global'||request.modality!=='text'||request.toolCount!==0
   ||!Number.isSafeInteger(request.inputTokens)||request.inputTokens<1
   ||!Number.isSafeInteger(request.maxOutputTokens)||request.maxOutputTokens<1||request.maxOutputTokens>model.maxOutputTokens
   ||request.inputTokens+request.maxOutputTokens>model.contextTokens)throw new Error('Text price estimate unavailable');
 const long=request.inputTokens>272000;
 const inputRate=BigInt(model.inputMicrosPerThousand)*(long?2n:1n);
 const outputRate=BigInt(model.outputMicrosPerThousand)*(long?3n:2n)/2n;
 const numerator=BigInt(request.inputTokens)*inputRate+BigInt(request.maxOutputTokens)*outputRate;
 // Integer arithmetic rounds up to one micro-USD rather than dropping fractional charges.
 const ceilingMicros=Number((numerator+999n)/1000n);
 if(!Number.isSafeInteger(ceilingMicros))throw new Error('Text price estimate overflow');
 return {ceilingMicros,estimateVersion:catalogueVersion};
}
