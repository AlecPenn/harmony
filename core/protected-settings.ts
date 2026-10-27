import {mkdir,open,readFile,rename,stat,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ProfileCipher} from '../packages/identity/vault.ts';
export class ProtectedSettings<T> {
  #path:string;#cipher:ProfileCipher;#queue:Promise<unknown>=Promise.resolve();
  constructor(path:string,cipher:ProfileCipher,private validate:(value:unknown)=>T){this.#path=path;this.#cipher=cipher;}
  #serial<T>(action:()=>Promise<T>){const result=this.#queue.then(action);this.#queue=result.catch(()=>{});return result;}
  async #read():Promise<T|null>{
    if(!await this.#cipher.available())throw new Error('Windows protected storage unavailable');
    try{
      const info=await stat(this.#path);if(!info.isFile()||info.size>8192)throw new Error('Invalid stored connection');
      const encrypted=await readFile(this.#path);if(encrypted.length>8192)throw new Error('Invalid stored connection');
      const text=await this.#cipher.decrypt(encrypted);if(text.length>4096)throw new Error('Invalid stored connection');
      return this.validate(JSON.parse(text));
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('Protected settings could not be read');}
  }
  read(){return this.#serial(()=>this.#read());}
  save(value:unknown,authorized:()=>boolean=()=>true){const clean=this.validate(value);return this.#serial(async()=>{
    if(!authorized())throw new Error('Protected settings write cancelled');
    if(!await this.#cipher.available())throw new Error('Windows protected storage unavailable');
    const bytes=await this.#cipher.encrypt(JSON.stringify(clean));if(!bytes.length||bytes.length>8192)throw new Error('Protected settings write failed');
    await mkdir(dirname(this.#path),{recursive:true});const temporary=`${this.#path}.${randomUUID()}.tmp`;
    try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}if(!authorized())throw new Error('Protected settings write cancelled');await rename(temporary,this.#path);}
    finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw new Error('Protected settings cleanup failed');});}
  });}
  clear(){return this.#serial(()=>unlink(this.#path).catch(error=>{if(error.code!=='ENOENT')throw new Error('Could not remove protected settings');}));}
}
