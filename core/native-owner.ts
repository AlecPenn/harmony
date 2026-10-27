import {spawn} from 'node:child_process';
import {join} from 'node:path';
import type {OwnerNativeRequest,OwnerNativeResult,OwnerTransport} from './owner-verification.ts';
/** One private stdio worker, fixed executable/script; native UI needs an explicit caller action. */
export class NativeOwnerWorker {
 #busy=false;
 constructor(private root:string){}
 get active(){return this.#busy;}
 readonly verify:OwnerTransport=(request,signal)=>this.#run(request,signal) as Promise<OwnerNativeResult>;
 probe():Promise<{available:boolean}>{return this.#run(null,AbortSignal.timeout(5000)) as Promise<{available:boolean}>;}
 #run(request:OwnerNativeRequest|null,signal:AbortSignal):Promise<unknown>{
  if(this.#busy||signal.aborted)return Promise.reject(new Error('Owner verifier unavailable'));
  this.#busy=true;
  return new Promise((resolve,reject)=>{
   const args=['-I',join(this.root,'workers','owner','worker.py'),...(request?[]:['--probe'])];
   const child=spawn(join(this.root,'.venv','Scripts','python.exe'),args,{cwd:this.root,windowsHide:true,stdio:['pipe','pipe','pipe']});
   let output='',bytes=0,failed=false,killTimer:ReturnType<typeof setTimeout>|undefined,guardTimer:ReturnType<typeof setTimeout>|undefined;
   const cancel=()=>{failed=true;child.stdin.write('cancel\n',()=>{});killTimer??=setTimeout(()=>{child.kill();guardTimer=setTimeout(()=>reject(new Error('Owner verifier shutdown could not be confirmed')),2000);},1000);};
   signal.addEventListener('abort',cancel,{once:true});
   const deadline=setTimeout(cancel,75000);
   child.stdin.on('error',()=>{failed=true;});child.stderr.on('data',()=>{});
   child.on('error',()=>{failed=true;});
   child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>12288){cancel();return;}output+=chunk.toString('utf8');});
   child.on('close',code=>{
    this.#busy=false;clearTimeout(deadline);if(killTimer)clearTimeout(killTimer);if(guardTimer)clearTimeout(guardTimer);signal.removeEventListener('abort',cancel);
    if(failed||signal.aborted||code!==0){reject(new Error('Owner verifier unavailable'));return;}
    try{
     const value:unknown=JSON.parse(output);
     if(!request&&(!value||typeof value!=='object'||Object.keys(value).join(',')!=='available'||typeof (value as {available:unknown}).available!=='boolean'))throw new Error();
     resolve(value);
    }catch{reject(new Error('Owner verifier unavailable'));}
   });
   if(signal.aborted)cancel();else if(request)child.stdin.write(JSON.stringify(request)+'\n',()=>{});
  });
 }
}
