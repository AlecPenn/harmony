import {checkPackDigests} from './pack-digests.ts';
import type {PackManifestValidator} from './pack-manifest.ts';

/** Preliminary in-memory checks only. Success is not permission to load: filesystem containment, stable snapshots,
 * content-specific validation, capability checks, and fail-soft selection are still required. */
export function checkPackCandidate(validator:PackManifestValidator,manifest:unknown,payloads:ReadonlyMap<string,Uint8Array>):{ok:true}|{ok:false;error:string}{
 const names=validator.checkPayloadNames(manifest);if(!names.ok)return names;
 return checkPackDigests(validator,manifest,payloads);
}
