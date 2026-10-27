import type {TurnContext} from '../packages/contracts/events.ts';
import {ActionApprovals,type ApprovalAuthority,type ApprovalTicket} from '../packages/permissions/approvals.ts';
import type {ProposedAction,ToolPolicy} from '../packages/permissions/policy.ts';
import {ResponsesTokenCounter} from '../packages/reasoning/token-count.ts';
import {textInput,textInputHash,type TextModel} from '../packages/reasoning/text-contract.ts';
import {estimateTextCeiling} from '../packages/reasoning/catalogue.ts';
import {reasoningRequestHash,type BoundTextRequest} from '../packages/reasoning/request-binding.ts';
/** Distinct consent: send this text for counting only, never permission to generate. */
export const estimatePolicy:ToolPolicy=Object.freeze({id:'reasoning.openai.estimate',version:1,risk:'CONFIRM',permissions:Object.freeze(['cloud_reasoning'])});
export function estimateProposal(personId:string,text:string,maxOutputTokens:number,budgetId:string,model:unknown='gpt-6-astra'):ProposedAction{
 const input=textInput(text,model);
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<16||maxOutputTokens>4096||typeof budgetId!=='string'||!/^[a-zA-Z0-9_.-]{1,100}$/.test(budgetId))throw new Error('Invalid estimate proposal');
 return {personId,toolId:estimatePolicy.id,inputs:{text,maxOutputTokens,budgetId,model:input.model,requestVersion:1}};
}
/** Private, offline-tested foundation. No IPC or spending allowance is enabled here. */
export class ApprovedEstimate {
 constructor(private approvals:ActionApprovals,private authority:ApprovalAuthority,private readKey:()=>Promise<string|null>,
  private counter:ResponsesTokenCounter=new ResponsesTokenCounter(),private now:()=>number=Date.now){}
 async estimate(ticket:ApprovalTicket,proposal:ProposedAction,turn:TurnContext,signal:AbortSignal):Promise<Readonly<BoundTextRequest>>{
  if(signal.aborted)throw new Error('Estimate cancelled');
  const reviewed=this.approvals.consume(ticket,proposal,turn);
  if(!reviewed||reviewed.action.toolId!==estimatePolicy.id||reviewed.toolVersion!==1)throw new Error('Estimate approval expired or denied');
  const inputs=reviewed.action.inputs as Record<string,unknown>;
  if(!inputs||Object.keys(inputs).sort().join(',')!=='budgetId,maxOutputTokens,model,requestVersion,text'||inputs.requestVersion!==1)throw new Error('Invalid estimate approval');
  const clean=estimateProposal(reviewed.action.personId,inputs.text as string,inputs.maxOutputTokens as number,inputs.budgetId as string,inputs.model).inputs as {text:string;maxOutputTokens:number;budgetId:string;model:TextModel};
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(20000)]);
  const current=()=>!combined.aborted&&this.authority.isCurrent(turn)&&this.authority.identifies(reviewed.action.personId,turn);
  try{
   if(!current())throw new Error();
   // Reject expired pricing before credential loading or disclosure, then check again after counting.
   estimateTextCeiling({modelId:clean.model,inputTokens:1,maxOutputTokens:clean.maxOutputTokens,nowMs:this.now(),processing:'standard',region:'global',modality:'text',toolCount:0});
   const key=await new Promise<string|null>((resolve,reject)=>{
    const abort=()=>reject(new Error('Cancelled'));combined.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{combined.throwIfAborted();return this.readKey();}).then(resolve,reject).finally(()=>combined.removeEventListener('abort',abort));
   });
   if(!current()||!key)throw new Error();
   const count=await this.counter.count({text:clean.text,model:clean.model,cloudApproved:true,signal:combined},key);
   if(!current()||count.inputHash!==textInputHash(clean.text,clean.model))throw new Error();
   const price=estimateTextCeiling({modelId:clean.model,inputTokens:count.inputTokens,maxOutputTokens:clean.maxOutputTokens,nowMs:this.now(),processing:'standard',region:'global',modality:'text',toolCount:0});
   const plan={personId:reviewed.action.personId,turnId:turn.id,budgetId:clean.budgetId,modelId:clean.model,text:clean.text,inputTokens:count.inputTokens,maxOutputTokens:clean.maxOutputTokens,...price};
   reasoningRequestHash(plan);return Object.freeze(plan);
  }catch{throw new Error(!current()?'Estimate cancelled':'Approved estimate did not complete');}
  finally{controller.abort();}
 }
}
