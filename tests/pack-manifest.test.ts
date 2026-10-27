import {test,expect} from 'vitest';
import {resolve} from 'node:path';
import {PackManifestValidator} from '../core/pack-manifest.ts';

const validator=new PackManifestValidator(resolve('.'));
const base={formatVersion:1,id:'org.example.dusk',name:'Dusk',version:'1.0.0',type:'theme',author:'Example',homepage:'https://example.org',license:'MIT',attribution:'Example, MIT',harmonyVersion:'0.1.0',files:{'tokens.json':'0'.repeat(64)},capabilities:{},content:{tokens:'tokens.json'}};

test('validates each manifest type against the bundled draft',()=>{
 expect(validator.check(base)).toEqual({ok:true});
 expect(validator.check({...base,type:'skin',content:{model:'model.glb',moods:'moods.json',fallback:'fallback.png'}})).toEqual({ok:true});
 expect(validator.check({...base,type:'voice',content:{engine:'kokoro',model:'voice.onnx',voiceData:'voices.bin'}})).toEqual({ok:true});
 expect(validator.check({...base,type:'sounds',content:{cues:'cues.json'}})).toEqual({ok:true});
});
test('rejects malformed and unknown manifest fields without accepting the pack as safe',()=>{
 const {license:_,...noLicense}=base;
 for(const input of [noLicense,{...base,files:{'../escape':'0'.repeat(64)}},{...base,files:{'tokens.json':'short'}},
  {...base,type:'voice',content:{engine:'kokoro',model:'voice.onnx'}},{...base,content:{tokens:'tokens.json',script:'run.js'}},
  {...base,type:'plugin'},null])expect(validator.check(input).ok).toBe(false);
});

test('strict manifest parsing rejects duplicates, invalid UTF-8 and oversized data',()=>{
 const bytes=(s:string)=>new TextEncoder().encode(s);
 expect(validator.parse(bytes(JSON.stringify(base))).ok).toBe(true);
 expect(validator.parse(bytes('{"type":"theme","type":"skin"}')).ok).toBe(false);
 expect(validator.parse(bytes('{"files":{"x":"a","\\u0078":"b"}}')).ok).toBe(false);
 expect(validator.parse(bytes('{/*comment*/"x":1}')).ok).toBe(false);
 expect(validator.parse(new Uint8Array([0xff])).ok).toBe(false);
 expect(validator.parse(new Uint8Array(65537)).ok).toBe(false);
});
