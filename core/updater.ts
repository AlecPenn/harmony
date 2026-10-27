import {spawn as nodeSpawn,type ChildProcess} from 'node:child_process';
import {existsSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';

/** One-click updates. New work arrives as commits in HARMONY's own folder (the develop branch); the app runs a build
 * made from one of them. When they differ, HARMONY says what's new. "Update yourself" (approved like any security
 * change) builds into dist-next/ while the current version keeps running untouched; only a complete build is marked
 * ready, and scripts/boot.cjs swaps it in on the restart that follows. The previous build is kept as dist-old/, so
 * "undo the update" rolls back on the next start. A failed build changes nothing.
 * Only the local folder is used: nothing is downloaded, and git itself isn't needed. */

export interface Commit {sha:string;subject:string;}
export interface UpdateStatus {
 head:string|null; built:string|null; available:boolean; commits:Commit[];
 state:'idle'|'building'|'ready'|'failed'; error:string|null; canUndo:boolean;
}
const SHA=/^[0-9a-f]{40}$/;

/** The commit the folder is at, read straight from .git (loose ref or packed-refs). */
export function repoHead(root:string):string|null{
 try{
  const git=join(root,'.git'),head=readFileSync(join(git,'HEAD'),'utf8').trim();
  if(SHA.test(head))return head;
  const ref=head.match(/^ref: (refs\/[\w./-]{1,200})$/)?.[1];if(!ref||ref.includes('..'))return null;
  try{const v=readFileSync(join(git,ref),'utf8').trim();if(SHA.test(v))return v;}catch{}
  for(const line of readFileSync(join(git,'packed-refs'),'utf8').split('\n')){const [sha,name]=line.trim().split(' ');if(name===ref&&SHA.test(sha))return sha;}
 }catch{}
 return null;
}
/** A commit's parents and first line, from its loose object. Null if it's packed or unreadable. */
export function readCommit(root:string,sha:string):{parents:string[];subject:string}|null{
 if(!SHA.test(sha))return null;
 try{
  const raw=inflateSync(readFileSync(join(root,'.git','objects',sha.slice(0,2),sha.slice(2)))).toString('utf8');
  const nul=raw.indexOf('\0');if(!raw.startsWith('commit ')||nul<0)return null;
  const body=raw.slice(nul+1),split=body.indexOf('\n\n');
  const parents=[...body.slice(0,split<0?body.length:split).matchAll(/^parent ([0-9a-f]{40})$/gm)].map(m=>m[1]);
  const subject=(split<0?'':body.slice(split+2)).split('\n')[0].replace(/[\u0000-\u001f]/g,'').trim().slice(0,100);
  return {parents,subject};
 }catch{return null;}
}
/** Commits after `from` up to `to`, newest first (first parents only, at most `max`). */
export function newCommits(root:string,from:string|null,to:string,max=20):Commit[]{
 const out:Commit[]=[];let sha:string|undefined=to;
 while(sha&&sha!==from&&out.length<max){const c=readCommit(root,sha);if(!c)break;out.push({sha,subject:c.subject});sha=c.parents[0];}
 return out;
}

type Spawner=(command:string,args:readonly string[],options:{cwd:string;env:NodeJS.ProcessEnv;windowsHide:true;stdio:['ignore','pipe','pipe']})=>ChildProcess;
export class Updater {
 #state:UpdateStatus['state']='idle';#error:string|null=null;#child:ChildProcess|null=null;
 private root:string;private spawn:Spawner;private node:string;private env:NodeJS.ProcessEnv;
 constructor(root:string,options:{spawn?:Spawner;node?:string;env?:NodeJS.ProcessEnv}={}){
  this.root=root;this.spawn=options.spawn??(nodeSpawn as unknown as Spawner);
  // Inside Electron, its own executable runs Node scripts with ELECTRON_RUN_AS_NODE, so no separate Node is needed.
  this.node=options.node??process.execPath;this.env=options.env??process.env;
 }
 #dir(name:string){return join(this.root,name);}
 built():string|null{try{const v=JSON.parse(readFileSync(join(this.#dir('dist'),'build-info.json'),'utf8')).commit;return typeof v==='string'&&SHA.test(v)?v:null;}catch{return null;}}
 status():UpdateStatus{
  const head=repoHead(this.root),built=this.built();
  const available=!!head&&head!==built&&this.#state!=='ready';
  return {head,built,available,commits:available&&head&&built?newCommits(this.root,built,head,12):[],state:this.#state,error:this.#error,
   canUndo:existsSync(join(this.#dir('dist-old'),'electron','main.cjs'))};
 }
 /** Builds the folder's current commit into dist-next/. Resolves true when it's complete and marked ready. */
 build(timeoutMs=10*60000):Promise<boolean>{
  if(this.#state==='building')return Promise.resolve(false);
  const head=repoHead(this.root);if(!head){this.#state='failed';this.#error='Couldn\'t read which version is in the HARMONY folder.';return Promise.resolve(false);}
  const next=this.#dir('dist-next');rmSync(next,{recursive:true,force:true});
  this.#state='building';this.#error=null;
  return new Promise<boolean>(resolve=>{
   let tail='',done=false;
   const finish=(ok:boolean,why?:string)=>{
    if(done)return;done=true;clearTimeout(timer);this.#child=null;
    const complete=ok&&existsSync(join(next,'electron','main.cjs'))&&existsSync(join(next,'electron','preload.cjs'))&&existsSync(join(next,'renderer','index.html'));
    if(complete){writeFileSync(join(next,'.complete'),JSON.stringify({commit:head,at:new Date().toISOString()}));this.#state='ready';resolve(true);return;}
    rmSync(next,{recursive:true,force:true});this.#state='failed';
    this.#error=(why??(tail.trim().split('\n').slice(-3).join(' ')||'The build stopped without saying why.')).replace(/[\u0000-\u001f]+/g,' ').slice(0,300);resolve(false);
   };
   const timer=setTimeout(()=>{const c=this.#child;finish(false,'The build took too long and was stopped.');try{c?.kill();}catch{}},timeoutMs);
   let child:ChildProcess;
   try{child=this.spawn(this.node,[join(this.root,'scripts','build.mjs')],{cwd:this.root,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...this.env,ELECTRON_RUN_AS_NODE:'1',HARMONY_OUT:'dist-next',HARMONY_COMMIT:head}});}
   catch{finish(false,'The build couldn\'t start.');return;}
   this.#child=child;
   const keep=(d:Buffer)=>{tail=(tail+d.toString('utf8')).slice(-4000);};
   child.stdout?.on('data',keep);child.stderr?.on('data',keep);
   child.on('error',()=>finish(false,'The build couldn\'t start.'));
   child.on('close',code=>finish(code===0));
  });
 }
 /** Undo: the previous build comes back on the next start. */
 requestUndo():boolean{
  if(!this.status().canUndo)return false;
  rmSync(this.#dir('dist-next'),{recursive:true,force:true});if(this.#state==='ready')this.#state='idle';
  writeFileSync(this.#dir('.rollback-update'),new Date().toISOString());return true;
 }
 stop(){try{this.#child?.kill();}catch{}}
}
