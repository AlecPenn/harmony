import {reasoningCatalogue} from './catalogue.ts';
import {textModel,type TextModel} from './text-contract.ts';
import type {ReasoningTier} from './router.ts';
export type ReasoningChoice=TextModel|'auto:routine'|'auto:complex'|'auto:hardest';
/** Explicit task depth, never inferred from prompt text or model output. */
export function reasoningSelection(value:unknown):{modelId:TextModel;automatic:ReasoningTier|null}{
 if(typeof value==='string'&&['auto:routine','auto:complex','auto:hardest'].includes(value)){
  const tier=value.slice(5) as ReasoningTier,models=reasoningCatalogue.filter(model=>model.tier===tier);
  if(models.length!==1)throw new Error('Task depth has no unambiguous model');
  return {modelId:textModel(models[0].id),automatic:tier};
 }
 return {modelId:textModel(value),automatic:null};
}
