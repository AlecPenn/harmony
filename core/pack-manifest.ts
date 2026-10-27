import {Validator,type Schema} from '@cfworker/json-schema';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/** Validates manifest structure against the trusted schema bundled with HARMONY. This is not a pack loader: it does
 * not parse an untrusted JSON file, read assets, verify hashes, check paths on disk or make a pack safe to use. */
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
}
