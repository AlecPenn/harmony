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
 /** Check manifest-only path and reference rules. Actual files still require safe filesystem and content checks. */
 checkReferences(value:unknown):{ok:true}|{ok:false;error:string}{
  const shape=this.check(value);if(!shape.ok)return shape;
  const manifest=value as {files:Record<string,string>;content:Record<string,string>};
  const paths=Object.keys(manifest.files),seen=new Set<string>();
  for(const path of paths){
   const parts=path.split('/'),folded=path.toLowerCase();
   if(folded==='pack.json'||parts.length>32||parts.some(part=>/[. ]$/.test(part)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)))return {ok:false,error:`Unsafe payload path: ${path}`};
   if(seen.has(folded))return {ok:false,error:`Case-insensitive path collision: ${path}`};
   seen.add(folded);
  }
  for(const path of seen){const parts=path.split('/');for(let i=1;i<parts.length;i++)if(seen.has(parts.slice(0,i).join('/')))return {ok:false,error:`File/directory path collision: ${path}`};}
  for(const [key,path] of Object.entries(manifest.content)){
   if(key!=='engine'&&!Object.hasOwn(manifest.files,path))return {ok:false,error:`Unlisted content reference: ${path}`};
  }
  return {ok:true};
 }
 /** Filename screening only. A permitted extension does not prove that bytes are safe or valid for a given type. */
 checkPayloadNames(value:unknown):{ok:true}|{ok:false;error:string}{
  const refs=this.checkReferences(value);if(!refs.ok)return refs;
  const manifest=value as {type:'skin'|'voice'|'theme'|'sounds';files:Record<string,string>};
  const allowed:Record<typeof manifest.type,readonly string[]>={skin:['glb','json','png','webp','frag','webm','txt','md'],voice:['onnx','json','bin','wav','ogg','txt','md'],theme:['json','txt','md'],sounds:['json','wav','ogg','txt','md']};
  for(const path of Object.keys(manifest.files)){const name=path.split('/').at(-1)??'',dot=name.lastIndexOf('.'),ext=dot>0?name.slice(dot+1).toLowerCase():'';
   if(!ext||!allowed[manifest.type].includes(ext))return {ok:false,error:`Unsupported payload file: ${path}`};
  }
  return {ok:true};
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
   const result=this.checkReferences(value);return result.ok?{ok:true,value}:result;
  }catch{return {ok:false,error:'Invalid manifest JSON or UTF-8'};}
 }
}
