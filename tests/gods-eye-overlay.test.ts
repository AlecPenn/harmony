import {afterEach,expect,test} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {applyOverlay,manifestEntry,readManifest} from '../core/gods-eye-overlay.ts';

const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const tmp=()=>{const d=mkdtempSync(join(tmpdir(),'gev-ov-'));dirs.push(d);return d;};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function setup(){
 const up=tmp(),ov=tmp();mkdirSync(join(up,'src'),{recursive:true});writeFileSync(join(up,'src','a.js'),'original\n');
 mkdirSync(join(ov,'files','src'),{recursive:true});writeFileSync(join(ov,'files','src','a.js'),'changed\r\n');writeFileSync(join(ov,'files','src','new.js'),'added\n');
 const files=['src/a.js','src/new.js'].map(p=>manifestEntry(up,ov,p));
 writeFileSync(join(ov,'manifest.json'),JSON.stringify({version:1,commit:'c'.repeat(40),files}));
 return {up,ov};
}
test('lays files over the pinned original, keeps the original, and is a no-op the second time',()=>{
 const {up,ov}=setup();
 expect(applyOverlay(up,ov,'c'.repeat(40))).toEqual({applied:2,skipped:null});
 expect(readFileSync(join(up,'src','a.js'),'utf8')).toBe('changed\n');           // stored as LF
 expect(readFileSync(join(up,'.harmony-original','src','a.js'),'utf8')).toBe('original\n');
 expect(readFileSync(join(up,'src','new.js'),'utf8')).toBe('added\n');
 expect(applyOverlay(up,ov,'c'.repeat(40))).toEqual({applied:0,skipped:null});
});
test('refuses another God\'s Eye version, and a file that isn\'t the expected original',()=>{
 const {up,ov}=setup();
 expect(applyOverlay(up,ov,'d'.repeat(40)).skipped).toMatch(/is installed/);
 writeFileSync(join(up,'src','a.js'),'someone else changed this\n');
 expect(()=>applyOverlay(up,ov,'c'.repeat(40))).toThrow(/isn't the version/);
 expect(readFileSync(join(up,'src','a.js'),'utf8')).toBe('someone else changed this\n');
});
test('a newer overlay that drops a file puts the original back',()=>{
 const {up,ov}=setup();applyOverlay(up,ov,'c'.repeat(40));
 rmSync(join(ov,'files','src','a.js'));rmSync(join(ov,'files','src','new.js'));
 writeFileSync(join(ov,'files','src','b.js'),'b\n');
 writeFileSync(join(ov,'manifest.json'),JSON.stringify({version:1,commit:'c'.repeat(40),files:[{path:'src/b.js',base:null,sha256:sha('b\n')}]}));
 expect(applyOverlay(up,ov,'c'.repeat(40)).applied).toBe(1);
 expect(readFileSync(join(up,'src','a.js'),'utf8')).toBe('original\n');expect(existsSync(join(up,'src','new.js'))).toBe(false);
});
test('rejects unsafe manifests',()=>{
 const {ov}=setup();
 writeFileSync(join(ov,'manifest.json'),JSON.stringify({version:1,commit:'c'.repeat(40),files:[{path:'../evil.js',base:null,sha256:'a'.repeat(64)}]}));
 expect(readManifest(ov)).toBeNull();
});
test('HARMONY\'s real overlay matches its manifest and the pinned commit',()=>{
 const m=readManifest(join(process.cwd(),'overlays','gods-eye'))!;
 const pin=JSON.parse(readFileSync(join(process.cwd(),'docs','GODS-EYE-VIEW.json'),'utf8'));
 expect(m.commit).toBe(pin.commit);
 for(const f of m.files)expect(createHash('sha256').update(readFileSync(join(process.cwd(),'overlays','gods-eye','files',f.path),'utf8').replace(/\r\n/g,'\n')).digest('hex'),f.path).toBe(f.sha256);
});
