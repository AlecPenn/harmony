import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve,isAbsolute} from 'node:path';

/** HARMONY's changes to God's Eye View (October 26: features from the best community forks, credited in
 * overlays/gods-eye/README.md). God's Eye View stays the original, pinned archive; these files are laid on top each
 * time HARMONY starts it. Every replaced file is checked against the exact original it was written for (SHA-256 of
 * the pinned version), the original is kept beside it, and an overlay made for a different God's Eye version is not
 * applied at all, so an update can never be half-patched. Line endings are compared as LF (the archive's), since the
 * HARMONY folder on Windows may hold CRLF copies. */

export interface OverlayFile {path:string;base:string|null;sha256:string;}
export interface OverlayManifest {version:1;commit:string;files:OverlayFile[];}
export interface OverlayResult {applied:number;skipped:string|null;}

const lf=(b:Buffer)=>Buffer.from(b.toString('utf8').replace(/\r\n/g,'\n'),'utf8');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const safeRel=(p:string)=>typeof p==='string'&&p.length>0&&p.length<=200&&!isAbsolute(p)&&!p.split(/[\\/]/).includes('..')&&/^[\w./-]+$/.test(p);
const inside=(base:string,p:string)=>{const r=relative(base,p);return !!r&&!r.startsWith('..')&&!isAbsolute(r);};

export function readManifest(overlayDir:string):OverlayManifest|null{
 try{
  const m=JSON.parse(readFileSync(join(overlayDir,'manifest.json'),'utf8')) as OverlayManifest;
  if(m?.version!==1||typeof m.commit!=='string'||!Array.isArray(m.files))return null;
  if(!m.files.every(f=>safeRel(f.path)&&(f.base===null||/^[a-f0-9]{64}$/.test(f.base))&&/^[a-f0-9]{64}$/.test(f.sha256)))return null;
  return m;
 }catch{return null;}
}

/** Lays the overlay over an installed God's Eye View at `target` (installed at `commit`). Idempotent and cheap when
 * nothing changed. Undoes files a previous overlay changed that this one no longer does. */
export function applyOverlay(target:string,overlayDir:string,commit:string):OverlayResult{
 const m=readManifest(overlayDir);
 if(!m)return {applied:0,skipped:existsSync(join(overlayDir,'manifest.json'))?'The overlay manifest is invalid.':null};
 if(m.commit!==commit)return {applied:0,skipped:`The overlay is for God's Eye View ${m.commit.slice(0,7)}, but ${commit.slice(0,7)} is installed.`};
 const root=resolve(target),originals=join(root,'.harmony-original'),statePath=join(root,'.harmony-overlay.json');
 const manifestHash=sha(lf(readFileSync(join(overlayDir,'manifest.json'))));
 let state:{manifest:string;files:{path:string;base:string|null}[]}={manifest:'',files:[]};
 try{state=JSON.parse(readFileSync(statePath,'utf8'));}catch{}
 const current=(p:string)=>{try{return sha(lf(readFileSync(join(root,p))));}catch{return null;}};
 // Already applied and untouched: nothing to do.
 if(state.manifest===manifestHash&&m.files.every(f=>current(f.path)===f.sha256))return {applied:0,skipped:null};
 // 1. Put back every file a previous overlay changed (or remove files it added).
 for(const f of state.files??[]){
  if(!safeRel(f.path))continue;const dest=join(root,f.path);if(!inside(root,dest))continue;
  if(f.base===null)rmSync(dest,{force:true});
  else{const o=join(originals,f.path);if(existsSync(o))copyFileSync(o,dest);}
 }
 // 2. Check every target is exactly the original this overlay was written for, before changing anything.
 for(const f of m.files){
  const dest=join(root,f.path);if(!inside(root,dest))throw new Error(`Unsafe overlay path ${f.path}`);
  const now=current(f.path);
  if(f.base===null?now!==null&&now!==f.sha256:now!==f.base)throw new Error(`God's Eye View's ${f.path} isn't the version this overlay was made for.`);
  const src=join(overlayDir,'files',f.path);if(sha(lf(readFileSync(src)))!==f.sha256)throw new Error(`Overlay file ${f.path} doesn't match its manifest.`);
 }
 // 3. Keep the originals, then lay the overlay files on.
 for(const f of m.files){
  const dest=join(root,f.path),src=join(overlayDir,'files',f.path);
  if(f.base!==null){const o=join(originals,f.path);if(!existsSync(o)){mkdirSync(dirname(o),{recursive:true});copyFileSync(dest,o);}}
  mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,lf(readFileSync(src)));
 }
 writeFileSync(statePath,JSON.stringify({manifest:manifestHash,files:m.files.map(f=>({path:f.path,base:f.base})),appliedAt:new Date().toISOString()},null,1));
 return {applied:m.files.length,skipped:null};
}

/** Builds manifest entries for development: `files` maps each overlay path to whether it replaces an upstream file. */
export function manifestEntry(upstreamRoot:string,overlayDir:string,path:string):OverlayFile{
 const up=join(upstreamRoot,path),base=existsSync(up)?sha(lf(readFileSync(up))):null;
 return {path,base,sha256:sha(lf(readFileSync(join(overlayDir,'files',path))))};
}
