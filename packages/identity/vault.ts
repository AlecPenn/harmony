import {mkdir,open,readFile,rename,stat,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateProfiles} from './validate.ts';
import type {SpeakerProfile} from './contracts.ts';
export interface ProfileCipher {
  available():Promise<boolean>;
  encrypt(plaintext:string):Promise<Buffer>;
  decrypt(ciphertext:Buffer):Promise<string>;
}
const LIMIT=16*1024*1024;
/** Main-process-only, one instance per vault. No plaintext disk fallback or backups. */
export class ProfileVault {
  #path:string; #cipher:ProfileCipher; #queue:Promise<unknown>=Promise.resolve();
  constructor(path:string,cipher:ProfileCipher){this.#path=path;this.#cipher=cipher;}
  #serial<T>(operation:()=>Promise<T>):Promise<T>{const task=this.#queue.then(operation);this.#queue=task.catch(()=>{});return task;}
  async #ready(){if(!await this.#cipher.available())throw new Error('Protected household storage is unavailable');}
  async #read():Promise<SpeakerProfile[]>{
    await this.#ready();
    try{
      const info=await stat(this.#path);
      if(!info.isFile()||info.size>LIMIT)throw new Error('Invalid vault');
      const encrypted=await readFile(this.#path);
      if(encrypted.length>LIMIT)throw new Error('Invalid vault');
      const text=await this.#cipher.decrypt(encrypted);
      if(Buffer.byteLength(text,'utf8')>LIMIT)throw new Error('Invalid vault');
      const data=JSON.parse(text);
      if(!data||data.schemaVersion!==1||Object.keys(data).length!==2)throw new Error('Invalid vault');
      return validateProfiles(data.profiles);
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error('Household vault could not be read; existing data was preserved');}
  }
  read(){return this.#serial(()=>this.#read());}
  replace(value:unknown):Promise<void>{
    // Clone and validate before queuing so callers cannot mutate pending writes.
    const profiles=validateProfiles(value);
    return this.update(()=>profiles);
  }
  /** Atomic read/modify/write within this vault instance. */
  update(transform:(current:SpeakerProfile[])=>unknown,canCommit:()=>boolean=()=>true):Promise<void>{
    return this.#serial(async()=>{
      const current=await this.#read();
      if(!canCommit())throw new Error('Household update cancelled');
      const profiles=validateProfiles(transform(current));
      const plaintext=JSON.stringify({schemaVersion:1,profiles});
      if(Buffer.byteLength(plaintext,'utf8')>LIMIT)throw new Error('Household data exceeds storage limit');
      const encrypted=await this.#cipher.encrypt(plaintext);
      if(!Buffer.isBuffer(encrypted)||encrypted.length===0||encrypted.length>LIMIT)throw new Error('Protected household write failed');
      await mkdir(dirname(this.#path),{recursive:true});
      const temporary=`${this.#path}.${randomUUID()}.tmp`;
      try{
        const file=await open(temporary,'wx',0o600);
        try{await file.writeFile(encrypted);await file.sync();}finally{await file.close();}
        if(!canCommit())throw new Error('Household update cancelled');
        // Rename is the commit point; cancellation after dispatch does not undo the write.
        await rename(temporary,this.#path);
      }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw new Error('Protected temporary cleanup failed');});}
    });
  }
}
