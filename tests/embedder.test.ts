import {test,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {LocalEmbedder,memoryModelId,similarity} from '../core/embedder.ts';

const repo=resolve(import.meta.dirname,'..');
const hasPython=(()=>{try{execFileSync('python3',['-c','import onnxruntime,tokenizers,onnx'],{stdio:'ignore'});return true;}catch{return false;}})();

/** A throwaway HARMONY folder holding the real worker, a tiny stand-in model and a pinned manifest for it. */
function fakeRoot(){
 const root=mkdtempSync(join(tmpdir(),'harmony-embed-')),dir=join(root,'data','models','memory','tiny');
 mkdirSync(join(root,'workers','memory'),{recursive:true});mkdirSync(dir,{recursive:true});mkdirSync(join(root,'docs'));
 copyFileSync(join(repo,'workers','memory','embed_worker.py'),join(root,'workers','memory','embed_worker.py'));
 execFileSync('python3',['-c',`import sys;sys.path.insert(0,${JSON.stringify(join(repo,'workers','memory'))});from pathlib import Path;import test_embed_worker as t;t.tiny_model(Path(${JSON.stringify(dir)}))`]);
 const files=['model.onnx','tokenizer.json'].map(name=>{const data=readFileSync(join(dir,name));return {path:`data/models/memory/tiny/${name}`,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};});
 writeFileSync(join(root,'docs','MEMORY-MODEL.json'),JSON.stringify({id:'tiny-test',directory:'data/models/memory/tiny',model:'model.onnx',tokenizer:'tokenizer.json',files}));
 return root;
}

test('not set up is a normal state: no worker is started and nothing is returned',async()=>{
 const root=mkdtempSync(join(tmpdir(),'harmony-none-'));
 expect(memoryModelId(root)).toBeNull();
 const e=new LocalEmbedder(root,{spawn:()=>{throw new Error('must not start');}});
 expect(e.state).toBe('NOT_INSTALLED');expect(await e.embed(['hello'])).toBeNull();expect(await e.embed([])).toEqual([]);
});

test.skipIf(!hasPython)('the real worker loads a pinned model, returns unit vectors in order, and stops',async()=>{
 const root=fakeRoot(),e=new LocalEmbedder(root,{python:'python3',idleMs:60000});
 expect(e.model).toBe('tiny-test');
 const [a,b,a2]=(await e.embed(['plumber dave','soccer','plumber dave']))!;
 expect(e.state).toBe('READY');expect(a.length).toBe(8);
 expect(similarity(a,a)).toBeCloseTo(1,5);expect(similarity(a,a2)).toBeCloseTo(1,5);expect(similarity(a,b)).toBeLessThan(.999);
 // Requests queue one at a time; a cancelled one returns null without disturbing the next.
 const cancelled=new AbortController();cancelled.abort();
 const [x,y]=await Promise.all([e.embed(['soccer'],cancelled.signal),e.embed(['soccer'])]);
 expect(x).toBeNull();expect(similarity(y![0],b)).toBeCloseTo(1,5);
 await e.stop();expect(e.state).toBe('OFF');
},30000);

test.skipIf(!hasPython)('a model file changed after setup is refused, and search falls back to words',async()=>{
 const root=fakeRoot();writeFileSync(join(root,'data','models','memory','tiny','tokenizer.json'),'{"tampered":true}');
 const e=new LocalEmbedder(root,{python:'python3'});
 expect(await e.embed(['hello'])).toBeNull();expect(e.state).toBe('FAILED');
},30000);
