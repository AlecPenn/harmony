import {actionInputHash} from '../permissions/policy.ts';
export const textModels=Object.freeze(['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'] as const);
export type TextModel=typeof textModels[number];
export function textModel(value:unknown):TextModel{if(typeof value!=='string'||!textModels.includes(value as TextModel))throw new Error('Unsupported reasoning model');return value as TextModel;}
/** One immutable input contract shared by counting and generation. */
export function textInput(text:string,model:unknown='gpt-6-astra'){
 if(typeof text!=='string'||!text.trim()||text.length>8000)throw new Error('Invalid reasoning text');
 return {model:textModel(model),instructions:'You are HARMONY, a personal assistant. Be clear and concise. You cannot execute tools or inspect this computer. Never claim an action was performed.',
  input:text,reasoning:{effort:'low'},tools:[],tool_choice:'none'} as const;
}
export function textInputHash(text:string,model:unknown='gpt-6-astra'):string{return actionInputHash({kind:'harmony.reasoning.input.v1',input:textInput(text,model)});}
