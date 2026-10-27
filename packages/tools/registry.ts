import {actionInputHash,type ToolPolicy} from '../permissions/policy.ts';
export type ValueSchema={type:'string';maxLength:number}|{type:'number'}|{type:'boolean'}|{type:'array';items:ValueSchema;maxItems:number}|{type:'object';properties:Record<string,ValueSchema>;required:readonly string[]};
export function validateSchema(schema:ValueSchema,depth=0):void{
 if(!schema||depth>12)throw new Error('Invalid tool schema');
 switch(schema.type){
  case 'string':if(!Number.isSafeInteger(schema.maxLength)||schema.maxLength<0||schema.maxLength>32768)throw new Error('Invalid string limit');break;
  case 'number':case 'boolean':break;
  case 'array':if(!Number.isSafeInteger(schema.maxItems)||schema.maxItems<0||schema.maxItems>1000)throw new Error('Invalid array limit');validateSchema(schema.items,depth+1);break;
  case 'object':{
   if(!schema.properties||!Array.isArray(schema.required)||Object.keys(schema.properties).length>128||new Set(schema.required).size!==schema.required.length||schema.required.some(k=>!Object.hasOwn(schema.properties,k)))throw new Error('Invalid object schema');
   for(const [key,value] of Object.entries(schema.properties)){if(!/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key)||['constructor','prototype'].includes(key))throw new Error('Invalid schema key');validateSchema(value,depth+1);}break;
  }
  default:throw new Error('Unknown schema type');
 }
}
export function validateValue(value:unknown,schema:ValueSchema):void{
 actionInputHash(value); // Enforce JSON-only, depth, size, accessor and finite-number limits first.
 function check(v:any,s:ValueSchema){
  if(s.type==='string'){if(typeof v!=='string'||v.length>s.maxLength)throw new Error('Invalid string');}
  else if(s.type==='number'){if(typeof v!=='number'||!Number.isFinite(v))throw new Error('Invalid number');}
  else if(s.type==='boolean'){if(typeof v!=='boolean')throw new Error('Invalid boolean');}
  else if(s.type==='array'){if(!Array.isArray(v)||v.length>s.maxItems)throw new Error('Invalid array');for(const item of v)check(item,s.items);}
  else{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!Object.hasOwn(s.properties,k))||s.required.some(k=>!Object.hasOwn(v,k)))throw new Error('Invalid object');for(const key of Object.keys(v))check(v[key],s.properties[key]);}
 }check(value,schema);
}
export interface ToolContext {signal:AbortSignal;actionId:string;}
export interface ToolDefinition extends ToolPolicy {
 name:string;description:string;inputSchema:ValueSchema;outputSchema:ValueSchema;
 available():boolean;
 execute(inputs:unknown,context:ToolContext):Promise<unknown>;
 verify(inputs:unknown,result:unknown,context:ToolContext):Promise<boolean>;
 /** Required for LOW_RISK_WRITE tools: how to find the effect again, and how to reverse it. */
 rollbackReference?(result:unknown):string;
 undo?(reference:string,context:ToolContext):Promise<boolean>;
}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
/** Only trusted built-in implementations. Registration never imports or executes plugin modules. */
export class ToolRegistry {
 #tools=new Map<string,Readonly<ToolDefinition>>();
 register(tool:ToolDefinition){
  if(this.#tools.size>=128||this.#tools.has(tool.id)||!/^[a-zA-Z0-9_.-]{1,80}$/.test(tool.id)||!Number.isSafeInteger(tool.version)||tool.version<1||!['SAFE','LOW_RISK_WRITE','CONFIRM','RESTRICTED'].includes(tool.risk)||!Array.isArray(tool.permissions)||!tool.permissions.length||tool.permissions.length>128||tool.permissions.some(p=>!/^[a-zA-Z0-9_.-]{1,80}$/.test(p))||new Set(tool.permissions).size!==tool.permissions.length)throw new Error('Invalid or duplicate tool');
  if(typeof tool.name!=='string'||tool.name.length<1||tool.name.length>80||typeof tool.description!=='string'||tool.description.length>500||![tool.execute,tool.verify,tool.available].every(f=>typeof f==='function'))throw new Error('Invalid tool implementation');
  if((tool.undo!==undefined&&typeof tool.undo!=='function')||(tool.rollbackReference!==undefined&&typeof tool.rollbackReference!=='function'))throw new Error('Invalid tool implementation');
  validateSchema(tool.inputSchema);validateSchema(tool.outputSchema);
  this.#tools.set(tool.id,freeze({...tool,permissions:[...tool.permissions],inputSchema:structuredClone(tool.inputSchema),outputSchema:structuredClone(tool.outputSchema)}));
 }
 resolve(id:string){const tool=this.#tools.get(id);if(!tool)throw new Error('Unknown tool');return tool;}
 policies():ToolPolicy[]{return [...this.#tools.values()].map(({id,version,risk,permissions})=>({id,version,risk,permissions:[...permissions]}));}
}
