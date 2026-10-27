import {Validator,type Schema} from '@cfworker/json-schema';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseTree,type Node,type ParseError} from 'jsonc-parser';

/** Validates manifest structure against the trusted schema bundled with HARMONY. This is not a pack loader: it does
 * not read assets, verify hashes, check paths on disk or make a pack safe to use. */
export class PackManifestValidator {
 private validator:Validator;
 constructor(root:string){
  const schema:Schema=JSON.parse(readFileSync(join(root,'docs','pack.schema.json'),'utf8')) as Schema;
  this.validator=new Validator(schema,'2020-12');
 }
 check(value:unknown):{ok:true}|{ok:false;error:string}{
  const result=this.validator.validate(value);if(result.valid)return {ok:true};
  const error=result.errors[0];
  return {ok:false,error:error?`Invalid manifest at ${error.instanceLocation||'/'}: ${error.error}`:'Invalid manifest'};
 }
 /** Bounded strict UTF-8 JSON, with duplicate keys rejected at every depth. No filesystem access. */
 parse(bytes:Uint8Array):{ok:true;value:unknown}|{ok:false;error:string}{
  if(bytes.byteLength>65536)return {ok:false,error:'Manifest exceeds 64 KiB'};
  try{
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text);
   const errors:ParseError[]=[],tree=parseTree(text,errors,{disallowComments:true,allowTrailingComma:false});
   if(!tree||errors.length)return {ok:false,error:'Invalid manifest JSON'};
   const stack:Node[]=[tree];
   while(stack.length){
    const node=stack.pop()!;
    if(node.type==='object'){
     const keys=new Set<string>();
     for(const property of node.children??[]){const key=property.children?.[0]?.value;
      if(typeof key!=='string'||keys.has(key))return {ok:false,error:'Duplicate or invalid manifest key'};
      keys.add(key);
     }
    }
    stack.push(...(node.children??[]));
   }
   const result=this.check(value);return result.ok?{ok:true,value}:result;
  }catch{return {ok:false,error:'Invalid manifest JSON or UTF-8'};}
 }
}
