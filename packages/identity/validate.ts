import type { SpeakerProfile } from './contracts.ts';
const fail=():never=>{throw new Error('Invalid household profile data');};
const keys=['id','displayName','role','modelId','stableEmbeddings','trustedRecentEmbeddings','permissions','memoryNamespace','settings','enrolledAt','lastCalibration'];
export function validateProfiles(value: unknown): SpeakerProfile[] {
  if(!Array.isArray(value)||value.length>32)return fail();
  const ids=new Set<string>(), namespaces=new Set<string>();
  for(const item of value){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==keys.length||Object.keys(item).some(k=>!keys.includes(k)))return fail();
    const token=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
    if(!token(item.id)||ids.has(item.id)||!token(item.memoryNamespace)||namespaces.has(item.memoryNamespace))return fail();
    ids.add(item.id);namespaces.add(item.memoryNamespace);
    if(typeof item.displayName!=='string'||item.displayName.trim().length<1||item.displayName.length>80||/[\x00-\x1f]/.test(item.displayName))return fail();
    if(!['OWNER','TEEN','CHILD','GUEST'].includes(item.role)||typeof item.modelId!=='string'||item.modelId.length<1||item.modelId.length>160)return fail();
    if(!Number.isSafeInteger(item.enrolledAt)||item.enrolledAt<=0||!Number.isSafeInteger(item.lastCalibration)||item.lastCalibration<0)return fail();
    if(!Array.isArray(item.permissions)||item.permissions.length>64||!item.permissions.every(token)||new Set(item.permissions).size!==item.permissions.length)return fail();
    if(!item.settings||typeof item.settings!=='object'||Array.isArray(item.settings)||Object.keys(item.settings).length>32||!Object.entries(item.settings).every(([k,v])=>token(k)&&typeof v==='boolean'&&!['__proto__','constructor','prototype'].includes(k)))return fail();
    if(!Array.isArray(item.stableEmbeddings)||item.stableEmbeddings.length<3||item.stableEmbeddings.length>20||!Array.isArray(item.trustedRecentEmbeddings)||item.trustedRecentEmbeddings.length>20)return fail();
    const dimension=item.stableEmbeddings[0]?.length;
    if(!Number.isInteger(dimension)||dimension<2||dimension>4096)return fail();
    for(const sample of [...item.stableEmbeddings,...item.trustedRecentEmbeddings]){
      if(!Array.isArray(sample)||sample.length!==dimension||!Array.from(sample).every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e6)||Math.hypot(...sample)<1e-12)return fail();
    }
  }
  return structuredClone(value);
}
