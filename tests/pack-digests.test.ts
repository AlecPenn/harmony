import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {PackManifestValidator} from '../core/pack-manifest.ts';
import {checkPackDigests} from '../core/pack-digests.ts';
const validator=new PackManifestValidator(resolve('.')),bytes=Buffer.from('{"surface":"#000"}');
const manifest={formatVersion:1,id:'org.example.test',name:'Test',version:'1.0.0',type:'theme',author:'Example',homepage:'https://example.org',license:'MIT',attribution:'Example, MIT',harmonyVersion:'0.1.0',files:{'tokens.json':createHash('sha256').update(bytes).digest('hex')},capabilities:{},content:{tokens:'tokens.json'}};
test('checks each declared payload and reports missing, altered or extra files',()=>{
 expect(checkPackDigests(validator,manifest,new Map([['tokens.json',bytes]]))).toEqual({ok:true});
 expect(checkPackDigests(validator,manifest,new Map()).ok).toBe(false);
 expect(checkPackDigests(validator,manifest,new Map([['tokens.json',Buffer.from('changed')]]))).toMatchObject({ok:false,error:'Checksum mismatch: tokens.json'});
 expect(checkPackDigests(validator,manifest,new Map([['tokens.json',bytes],['extra.js',Buffer.from('')]]))).toMatchObject({ok:false,error:'Unlisted payload: extra.js'});
 expect(checkPackDigests(validator,{...manifest,content:{tokens:'missing.json'}},new Map([['tokens.json',bytes]])).ok).toBe(false);
});
