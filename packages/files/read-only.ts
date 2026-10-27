import {lstat,realpath,open} from 'node:fs/promises';
import {isAbsolute,join,relative,sep,parse} from 'node:path';
const reserved=/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
const denied=new Set(['credentials','tokens','voice-samples','embeddings','node_modules']);
export function relativeParts(value:unknown):string[]{
 if(typeof value!=='string'||!value||value.length>512||value.includes('~')||isAbsolute(value)||/[\x00-\x1f:*?"<>|]/.test(value))throw new Error('Invalid relative file path');
 const parts=value.split(/[\\/]/);
 if(parts.length>32||parts.some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||/[. ]$/.test(p)||reserved.test(p)||denied.has(p.toLowerCase())))throw new Error('File path is outside the permitted scope');
 return parts;
}
function within(root:string,path:string){const rel=relative(root,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);}
/** Explicit-root read-only broker. No default roots, shell, recursive writes or automatic grants. */
export class ReadOnlyFiles {
 #pending=0;
 #roots=new Map<string,{path:string;device:bigint;inode:bigint}>();
 async addRoot(id:string,path:string){
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id)||this.#roots.has(id)||this.#roots.size>=8||!isAbsolute(path))throw new Error('Invalid file root');
  const info=await lstat(path,{bigint:true});if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Root must be a real directory');
  const canonical=await realpath(path);if(canonical===parse(canonical).root)throw new Error('A whole volume cannot be a file root');
  const checked=await lstat(canonical,{bigint:true});if(checked.dev!==info.dev||checked.ino!==info.ino)throw new Error('Root changed');
  if(this.#roots.has(id)||this.#roots.size>=8)throw new Error('Root registration limit');
  this.#roots.set(id,{path:canonical,device:info.dev,inode:info.ino});return canonical;
 }
 revokeRoot(id:string){this.#roots.delete(id);}
 async readText(rootId:string,path:string,signal:AbortSignal):Promise<{text:string;bytes:number}>{
  signal.throwIfAborted();if(this.#pending>=4)throw new Error('Too many file reads');const root=this.#roots.get(rootId);if(!root)throw new Error('File root is not approved');
  const parts=relativeParts(path),target=join(root.path,...parts);
  if(!within(root.path,target))throw new Error('Outside approved root');
  this.#pending++;try{
  const validate=async()=>{
   signal.throwIfAborted();if(this.#roots.get(rootId)!==root)throw new Error('File root was revoked');
   const base=await lstat(root.path,{bigint:true});if(base.isSymbolicLink()||base.dev!==root.device||base.ino!==root.inode)throw new Error('File root changed');
   let current=root.path;
   for(let i=0;i<parts.length;i++){
    current=join(current,parts[i]);const info=await lstat(current,{bigint:true});
    if(info.isSymbolicLink()||(i<parts.length-1&&!info.isDirectory())||(i===parts.length-1&&!info.isFile()))throw new Error('Links and special files are not readable');
   }
   const canonical=await realpath(target);if(!within(root.path,canonical))throw new Error('File resolved outside root');relativeParts(relative(root.path,canonical));
   return lstat(target,{bigint:true});
  };
  const before=await validate();if(before.size>131072n)throw new Error('File exceeds preview limit');
  const file=await open(target,'r');
  try{
   const opened=await file.stat({bigint:true});if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.size>131072n)throw new Error('File changed before reading');
   // Read at most limit+1 bytes even if another process grows the file after stat.
   const bytes=Buffer.alloc(131073);let length=0;
   while(length<bytes.length){signal.throwIfAborted();const chunk=await file.read(bytes,length,bytes.length-length,null);if(!chunk.bytesRead)break;length+=chunk.bytesRead;}
   if(length>131072)throw new Error('File exceeds preview limit');
   const after=await validate(),held=await file.stat({bigint:true});
   if(after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||held.size!==opened.size||after.mtimeNs!==opened.mtimeNs||held.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||held.ctimeNs!==opened.ctimeNs)throw new Error('File changed while reading');
   signal.throwIfAborted();if(this.#roots.get(rootId)!==root)throw new Error('File root was revoked');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));if(text.includes('\0'))throw new Error('Binary file preview is unavailable');
   return {text,bytes:length};
  }finally{await file.close();}
  }finally{this.#pending--;}
 }
}
