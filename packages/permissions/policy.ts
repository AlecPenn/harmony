import {createHash} from 'node:crypto';
// Canonical tool ids reserved as permanently unavailable to general tool execution.
export const permanentlyDeniedTools=Object.freeze(['credentials.export','security.disable'] as const);
export type Risk='SAFE'|'LOW_RISK_WRITE'|'CONFIRM'|'RESTRICTED';
export interface ToolPolicy {id:string;version:number;risk:Risk;permissions:readonly string[];}
export interface PersonPolicy {id:string;permissions:readonly string[];}
export interface PermissionSettings {denyTools:readonly string[];lowRiskWriteTools:readonly string[];}
export interface ProposedAction {toolId:string;personId:string;inputs:unknown;}
export type PermissionDecision={state:'DENIED';reason:'unknown_tool'|'unknown_person'|'denylist'|'permission'|'restricted'|'invalid_inputs'}|{state:'ALLOWED'|'APPROVAL_REQUIRED';toolId:string;personId:string;risk:Risk;inputsHash:string;toolVersion:number;};
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(v);
const list=(v:readonly string[])=>Array.isArray(v)&&v.length<=128&&v.every(identifier)&&new Set(v).size===v.length;
/** Bounded deterministic JSON. Hashes bind approval to actual values, not preview prose. */
export function actionInputHash(value:unknown):string {
 let nodes=0,characters=0;
 function walk(v:unknown,depth:number):string{
  if(++nodes>10000||depth>16)throw new Error('Action inputs exceed limit');
  if(v===null)return 'null';
  if(typeof v==='boolean')return String(v);
  if(typeof v==='number'){if(!Number.isFinite(v))throw new Error('Invalid action number');return JSON.stringify(v);}
  if(typeof v==='string'){characters+=v.length;if(characters>32768)throw new Error('Action inputs exceed limit');return JSON.stringify(v);}
  if(typeof v!=='object')throw new Error('Action inputs must be JSON');
  if(Array.isArray(v)){
   if(v.length>1000||Object.getOwnPropertyNames(v).length!==v.length+1||Object.getOwnPropertySymbols(v).length)throw new Error('Invalid action array');
   const descriptors=Object.getOwnPropertyDescriptors(v);
   return '['+Array.from({length:v.length},(_,index)=>{const d=descriptors[String(index)];if(!d||!d.enumerable||!('value' in d))throw new Error('Invalid action array');return walk(d.value,depth+1);}).join(',')+']';
  }
  if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw new Error('Invalid action object');
  const entries=Object.getOwnPropertyDescriptors(v),keys=Object.keys(entries).sort();
  if(Object.getOwnPropertySymbols(v).length||keys.length>128)throw new Error('Invalid action object');
  return '{'+keys.map(key=>{
   const descriptor=entries[key];if(!descriptor.enumerable||!('value' in descriptor)||['__proto__','constructor','prototype'].includes(key))throw new Error('Invalid action property');
   characters+=key.length;if(characters>32768)throw new Error('Action inputs exceed limit');
   return JSON.stringify(key)+':'+walk(descriptor.value,depth+1);
  }).join(',')+'}';
 }
 const encoded=walk(value,0);if(Buffer.byteLength(encoded,'utf8')>65536)throw new Error('Action inputs exceed limit');
 return createHash('sha256').update(encoded).digest('hex');
}
/** Trusted registry/settings only. No model-provided risk or blanket owner bypass. */
export class PermissionPolicy {
 #tools:Map<string,ToolPolicy>;#people:Map<string,PersonPolicy>;#settings:PermissionSettings;
 constructor(tools:readonly ToolPolicy[],people:readonly PersonPolicy[],settings:PermissionSettings){
  if(tools.length>512||people.length>32||!list(settings.denyTools)||!list(settings.lowRiskWriteTools))throw new Error('Invalid permission configuration');
  if(tools.some(t=>!identifier(t.id)||!Number.isSafeInteger(t.version)||t.version<1||!['SAFE','LOW_RISK_WRITE','CONFIRM','RESTRICTED'].includes(t.risk)||!list(t.permissions)||t.permissions.length===0)||new Set(tools.map(t=>t.id)).size!==tools.length)throw new Error('Invalid tool policy');
  if(people.some(p=>!identifier(p.id)||!list(p.permissions))||new Set(people.map(p=>p.id)).size!==people.length)throw new Error('Invalid person policy');
  this.#tools=new Map(structuredClone(tools).map(t=>[t.id,t]));this.#people=new Map(structuredClone(people).map(p=>[p.id,p]));this.#settings=structuredClone(settings);
 }
 evaluate(action:ProposedAction):PermissionDecision{
  const tool=this.#tools.get(action.toolId);if(!tool)return {state:'DENIED',reason:'unknown_tool'};
  if((permanentlyDeniedTools as readonly string[]).includes(tool.id)||this.#settings.denyTools.includes(tool.id))return {state:'DENIED',reason:'denylist'};
  const person=this.#people.get(action.personId);if(!person)return {state:'DENIED',reason:'unknown_person'};
  if(tool.permissions.some(p=>!person.permissions.includes(p)))return {state:'DENIED',reason:'permission'};
  // Strong authentication adapter does not exist yet. Restricted actions always remain blocked.
  if(tool.risk==='RESTRICTED')return {state:'DENIED',reason:'restricted'};
  let inputsHash:string;try{inputsHash=actionInputHash(action.inputs);}catch{return {state:'DENIED',reason:'invalid_inputs'};}
  return {state:tool.risk==='SAFE'||(tool.risk==='LOW_RISK_WRITE'&&this.#settings.lowRiskWriteTools.includes(tool.id))?'ALLOWED':'APPROVAL_REQUIRED',toolId:tool.id,personId:person.id,risk:tool.risk,toolVersion:tool.version,inputsHash};
 }
}
