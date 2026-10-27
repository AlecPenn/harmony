import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {PackManifestValidator} from '../core/pack-manifest.ts';
import {checkPackCandidate} from '../core/pack-candidate.ts';
const validator=new PackManifestValidator(resolve('.')),bytes=Buffer.from('{}'),digest=createHash('sha256').update(bytes).digest('hex');
const manifest={formatVersion:1,id:'org.example.test',name:'Test',version:'1.0.0',type:'theme',author:'Example',homepage:'https://example.org',license:'MIT',attribution:'Example, MIT',harmonyVersion:'0.1.0',files:{'tokens.json':digest},capabilities:{},content:{tokens:'tokens.json'}};
test('preliminary candidate checks reject executable filenames, tampering, and unlisted payloads',()=>{
 expect(checkPackCandidate(validator,manifest,new Map([['tokens.json',bytes]]))).toEqual({ok:true});
 const script=Buffer.from('code');const withScript={...manifest,files:{...manifest.files,'run.js':createHash('sha256').update(script).digest('hex')}};
 expect(checkPackCandidate(validator,withScript,new Map([['tokens.json',bytes],['run.js',script]])).ok).toBe(false);
 expect(checkPackCandidate(validator,manifest,new Map([['tokens.json',Buffer.from('changed')]])).ok).toBe(false);
 expect(checkPackCandidate(validator,manifest,new Map([['tokens.json',bytes],['extra.json',bytes]])).ok).toBe(false);
});
