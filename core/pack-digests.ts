import {createHash,timingSafeEqual} from 'node:crypto';
import type {PackManifestValidator} from './pack-manifest.ts';

/** Check the exact payload bytes supplied by a caller. This function does not read paths, prove the bytes will remain
 * unchanged, classify file content, or authorize a pack to load. Run off the audio/inference thread. */
export function checkPackDigests(validator:PackManifestValidator,manifest:unknown,payloads:ReadonlyMap<string,Uint8Array>):{ok:true}|{ok:false;error:string}{
 const check=validator.checkReferences(manifest);if(!check.ok)return check;
 const files=(manifest as {files:Record<string,string>}).files;
 for(const path of payloads.keys())if(!Object.hasOwn(files,path))return {ok:false,error:`Unlisted payload: ${path}`};
 for(const [path,digest] of Object.entries(files)){
  const bytes=payloads.get(path);if(!bytes)return {ok:false,error:`Missing payload: ${path}`};
  const actual=createHash('sha256').update(bytes).digest(),expected=Buffer.from(digest,'hex');
  if(!timingSafeEqual(actual,expected))return {ok:false,error:`Checksum mismatch: ${path}`};
 }
 return {ok:true};
}
