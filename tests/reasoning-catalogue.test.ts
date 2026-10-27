import {test,expect} from 'vitest';
import {catalogueExpiresAt,catalogueReviewedAt,estimateTextCeiling,reasoningCatalogue,type TextCostRequest} from '../packages/reasoning/catalogue.ts';
const request=(overrides:Partial<TextCostRequest>={}):TextCostRequest=>({modelId:'gpt-6-luna',inputTokens:1000,maxOutputTokens:1000,nowMs:catalogueReviewedAt,processing:'standard',region:'global',modality:'text',toolCount:0,...overrides});
test('catalogue keeps exact requested tier identifiers without asserting account availability',()=>{
 expect(reasoningCatalogue.map(model=>[model.id,model.tier])).toEqual([['gpt-6-luna','routine'],['gpt-6.1-sol','complex'],['gpt-6-astra','hardest']]);
 expect(Object.isFrozen(reasoningCatalogue)).toBe(true);expect(reasoningCatalogue.every(Object.isFrozen)).toBe(true);
 expect(reasoningCatalogue.some(model=>'ready' in model||'healthy' in model)).toBe(false);
});
test('standard text ceilings use worst-case input cache-write pricing and round upward',()=>{
 expect(estimateTextCeiling(request()).ceilingMicros).toBe(625);
 expect(estimateTextCeiling(request({modelId:'gpt-6.1-sol'})).ceilingMicros).toBe(12500);
 expect(estimateTextCeiling(request({modelId:'gpt-6-astra'})).ceilingMicros).toBe(62500);
 expect(estimateTextCeiling(request({inputTokens:1,maxOutputTokens:1})).ceilingMicros).toBe(1);
});
test('long input pricing applies to the whole request strictly above 272000 tokens',()=>{
 expect(estimateTextCeiling(request({inputTokens:272000,maxOutputTokens:1000})).ceilingMicros).toBe(34500);
 expect(estimateTextCeiling(request({inputTokens:272001,maxOutputTokens:1000})).ceilingMicros).toBe(68751);
});
test('stale or future-dated price evidence is unavailable rather than a free route',()=>{
 for(const nowMs of [catalogueReviewedAt-1,catalogueExpiresAt,NaN])expect(()=>estimateTextCeiling(request({nowMs}))).toThrow();
 expect(()=>estimateTextCeiling(request({nowMs:catalogueExpiresAt-1}))).not.toThrow();
});
test('unsupported models, pricing categories and token counts fail closed',()=>{
 for(const patch of [{extraToolFee:20},{modelId:'unknown'},{processing:'fast'},{region:'eu'},{modality:'image'},{toolCount:1},{inputTokens:0},{inputTokens:1.5},{inputTokens:NaN},{maxOutputTokens:128001},{inputTokens:1050000}])
  expect(()=>estimateTextCeiling(request(patch as any))).toThrow();
});
