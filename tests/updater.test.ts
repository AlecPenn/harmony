import {expect,it} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {repoHead,newCommits,Updater} from '../core/updater.ts';

function repo(){
 const dir=mkdtempSync(join(tmpdir(),'upd-')),git=(...a:string[])=>execFileSync('git',a,{cwd:dir,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@t',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@t'}}).trim();
 git('init','-q','-b','develop');
 const commit=(msg:string)=>{writeFileSync(join(dir,'f.txt'),msg);git('add','f.txt');git('commit','-q','-m',msg);return git('rev-parse','HEAD');};
 return {dir,git,commit};
}
it('reads the current commit and what is new since the build, without git',()=>{
 const {dir,git,commit}=repo();
 const a=commit('First thing'),b=commit('Spiral Time: hand background work to Claude\n\nBody text'),c=commit('Daily self-check');
 expect(repoHead(dir)).toBe(c);
 expect(newCommits(dir,a,c)).toEqual([{sha:c,subject:'Daily self-check'},{sha:b,subject:'Spiral Time: hand background work to Claude'}]);
 expect(newCommits(dir,c,c)).toEqual([]);
 git('pack-refs','--all');expect(repoHead(dir)).toBe(c); // packed refs
 git('gc','-q');expect(newCommits(dir,a,c)).toEqual([]); // packed objects: no list, but no crash
 writeFileSync(join(dir,'.git','HEAD'),'ref: refs/../../etc/passwd\n');expect(repoHead(dir)).toBeNull();
});
function fakeSpawn(behaviour:(env:NodeJS.ProcessEnv,cwd:string,child:EventEmitter&{stdout:EventEmitter;stderr:EventEmitter;kill():void})=>void){
 return ((_c:string,_a:readonly string[],o:{cwd:string;env:NodeJS.ProcessEnv})=>{const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill(){child.emit('close',null);}});setTimeout(()=>behaviour(o.env,o.cwd,child),5);return child;}) as never;
}
it('builds beside the running version; only a complete build is ready; a failed one changes nothing',async()=>{
 const {dir,commit}=repo();const a=commit('one');
 mkdirSync(join(dir,'dist','electron'),{recursive:true});writeFileSync(join(dir,'dist','electron','main.cjs'),'old');writeFileSync(join(dir,'dist','build-info.json'),JSON.stringify({commit:a}));
 const b=commit('Two: the new thing');
 const ok=new Updater(dir,{spawn:fakeSpawn((env,cwd,child)=>{expect(env.HARMONY_OUT).toBe('dist-next');expect(env.ELECTRON_RUN_AS_NODE).toBe('1');expect(env.HARMONY_COMMIT).toBe(b);
  const out=join(cwd,'dist-next');mkdirSync(join(out,'electron'),{recursive:true});mkdirSync(join(out,'renderer'));
  for(const f of ['electron/main.cjs','electron/preload.cjs','renderer/index.html'])writeFileSync(join(out,f),'new');child.emit('close',0);})});
 expect(ok.status()).toMatchObject({available:true,built:a,head:b,state:'idle',commits:[{subject:'Two: the new thing'}]});
 expect(await ok.build()).toBe(true);
 expect(JSON.parse(readFileSync(join(dir,'dist-next','.complete'),'utf8')).commit).toBe(b);
 expect(readFileSync(join(dir,'dist','electron','main.cjs'),'utf8')).toBe('old'); // running version untouched
 expect(ok.status()).toMatchObject({state:'ready',available:false});
 const bad=new Updater(dir,{spawn:fakeSpawn((_e,cwd,child)=>{mkdirSync(join(cwd,'dist-next','electron'),{recursive:true});child.stderr.emit('data',Buffer.from('src/x.ts:1:1: ERROR: Unexpected "}"\n'));child.emit('close',1);})});
 expect(await bad.build()).toBe(false);
 expect(bad.status()).toMatchObject({state:'failed',error:expect.stringMatching(/Unexpected/)});expect(existsSync(join(dir,'dist-next'))).toBe(false);
 const half=new Updater(dir,{spawn:fakeSpawn((_e,cwd,child)=>{mkdirSync(join(cwd,'dist-next','electron'),{recursive:true});writeFileSync(join(cwd,'dist-next','electron','main.cjs'),'x');child.emit('close',0);})});
 expect(await half.build()).toBe(false);expect(existsSync(join(dir,'dist-next'))).toBe(false); // exit 0 but incomplete
 const slow=new Updater(dir,{spawn:fakeSpawn(()=>{})});expect(await slow.build(50)).toBe(false);expect(slow.status().error).toMatch(/too long/);
});
it('boot swaps in a finished update, keeps the old one for undo, discards unfinished builds, and rolls back on request',()=>{
 const root=mkdtempSync(join(tmpdir(),'boot-'));mkdirSync(join(root,'scripts'));copyFileSync(resolve('scripts/boot.cjs'),join(root,'scripts','boot.cjs'));
 const version=(dist:string,name:string)=>{mkdirSync(join(root,dist,'electron'),{recursive:true});writeFileSync(join(root,dist,'electron','main.cjs'),`require('fs').writeFileSync(${JSON.stringify(join(root,'ran.txt'))},${JSON.stringify(name)});`);};
 const boot=()=>{const r=spawnSync(process.execPath,[join(root,'scripts','boot.cjs')],{encoding:'utf8'});expect(r.status).toBe(0);return readFileSync(join(root,'ran.txt'),'utf8');};
 version('dist','v1');expect(boot()).toBe('v1');
 version('dist-next','v2');expect(boot()).toBe('v1'); // not marked complete: discarded
 expect(existsSync(join(root,'dist-next'))).toBe(false);
 version('dist-next','v2');writeFileSync(join(root,'dist-next','.complete'),'{}');
 expect(boot()).toBe('v2');expect(existsSync(join(root,'dist-old','electron','main.cjs'))).toBe(true);expect(existsSync(join(root,'dist','.complete'))).toBe(false);
 writeFileSync(join(root,'.rollback-update'),'x');expect(boot()).toBe('v1');expect(existsSync(join(root,'.rollback-update'))).toBe(false);
 expect(boot()).toBe('v1');
});
it('the real build can be relocated, and records its commit',()=>{
 const out=mkdtempSync(join(tmpdir(),'build-out-'));
 const r=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:resolve('.'),encoding:'utf8',env:{...process.env,HARMONY_OUT:out,HARMONY_COMMIT:'a'.repeat(40)}});
 expect(r.status).toBe(0);
 for(const f of ['electron/main.cjs','electron/preload.cjs','renderer/index.html'])expect(existsSync(join(out,f))).toBe(true);
 expect(JSON.parse(readFileSync(join(out,'build-info.json'),'utf8')).commit).toBe('a'.repeat(40));
},180000);
it('by voice: "update yourself", "undo the update", and "run a self-check" reach the right place',async()=>{
 const {openDatabase}=await import('../core/storage.ts'),{ReminderStore}=await import('../core/reminders.ts'),{AssistantActions}=await import('../core/assistant-actions.ts');
 const db=openDatabase(':memory:'),clock=()=>new Date(2026,9,22,9,0),calls:string[]=[];
 const status={head:'b'.repeat(40),built:'a'.repeat(40),available:true,commits:[{sha:'b'.repeat(40),subject:'Spiral Time'}],state:'idle' as const,error:null,canUndo:true};
 const actions=new AssistantActions(new ReminderStore(db,clock),db,()=>{},clock,null,null,null,null,null,null,null,{diagnostics:()=>'Self-check: all 9 checks fine.',
  update:{status:()=>status,apply:async()=>{calls.push('apply');return 'Updating. I\'ll keep working while it builds, then restart in about a minute.';},undo:async()=>{calls.push('undo');return 'Going back to the previous version. Restarting now.';}}});
 const run=async(text:string)=>{const call=actions.shortcut(text)!;const args=Object.fromEntries([...call.matchAll(/<parameter=(\w+)>\n([^]*?)\n<\/parameter>/g)].map(m=>[m[1],m[2]]));return actions.run([{name:'status_report',arguments:args}],new AbortController().signal);};
 expect((await run('Harmony, update yourself.')).spoken).toMatch(/^Updating/);
 expect((await run('undo the update')).spoken).toMatch(/previous version/);
 expect(calls).toEqual(['apply','undo']);
 expect((await run('run a self-check')).lookup?.report).toMatch(/all 9 checks fine[^]*whether everything is fine/);
 expect((await actions.run([{name:'status_report',arguments:{focus:''}}],new AbortController().signal)).lookup?.report).toMatch(/An update is ready \(Spiral Time\)/);
 db.close();
});
