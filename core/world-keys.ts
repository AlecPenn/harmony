import type {ProfileCipher} from '../packages/identity/vault.ts';
import {ProtectedSettings} from './protected-settings.ts';

/** API keys for world data (from God's Eye v9), kept only in a Windows-encrypted file (credentials/world-keys.enc).
 * They are imported straight from v9's server.py on this PC. Values never reach the screen, logs, git or the model.
 * Only names are ever shown. God's Eye View gets the ones it understands as environment variables when it starts. */
export const WORLD_KEYS=['OPENSKY_CLIENT_ID','OPENSKY_CLIENT_SECRET','ACLED_KEY','ACLED_EMAIL','SAFECAST_API_KEY','GRIDSTATUS_API_KEY','NASA_FIRMS_MAP_KEY',
 'OPENAQ_API_KEY','OPENWEATHER_KEY','GFW_API_KEY','PURPLEAIR_READ_KEY','AIS_API_KEY','NASA_API_KEY','OTX_API_KEY','WAQI_TOKEN'] as const;
export type WorldKey=typeof WORLD_KEYS[number];
export type WorldKeys=Partial<Record<WorldKey,string>>;
const plausible=(v:unknown):v is string=>typeof v==='string'&&v.length>=4&&v.length<=1200&&/^[\x21-\x7e]+$/.test(v)&&!/^(your|xxx|changeme|none|null|todo)/i.test(v);
export function validateKeys(value:unknown):WorldKeys{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid keys');
 const out:WorldKeys={};for(const k of WORLD_KEYS){const v=(value as Record<string,unknown>)[k];if(plausible(v))out[k]=v;}
 return out;
}
/** Reads `NAME = "value"` assignments for the known key names from v9's server.py text. Unknown names are ignored. */
export function keysFromV9(source:string):WorldKeys{
 const out:Record<string,string>={};
 for(const m of source.slice(0,500_000).matchAll(/^([A-Z][A-Z0-9_]{2,40})\s*=\s*(['"])([^'"\r\n]{1,1200})\2\s*(?:#.*)?$/gm))
  if((WORLD_KEYS as readonly string[]).includes(m[1])&&plausible(m[3]))out[m[1]]=m[3];
 return out;
}
/** God's Eye View's own variable names for the keys it supports (see its .env.example). */
export function gevEnv(keys:WorldKeys):Record<string,string>{
 const env:Record<string,string>={};
 if(keys.NASA_FIRMS_MAP_KEY)env.FIRMS_MAP_KEY=keys.NASA_FIRMS_MAP_KEY;
 if(keys.OPENSKY_CLIENT_ID&&keys.OPENSKY_CLIENT_SECRET){env.OPENSKY_AUTH_MODE='oauth';env.OPENSKY_CLIENT_ID=keys.OPENSKY_CLIENT_ID;env.OPENSKY_CLIENT_SECRET=keys.OPENSKY_CLIENT_SECRET;}
 if(keys.AIS_API_KEY)env.AISSTREAM_API_KEY=keys.AIS_API_KEY; // v9 streams from aisstream.io with this key
 return env;
}
export class WorldKeyStore extends ProtectedSettings<WorldKeys> {
 constructor(path:string,cipher:ProfileCipher){super(path,cipher,validateKeys);}
 /** Names only, never values. */
 async status():Promise<{names:WorldKey[];available:boolean}>{
  try{const v=await this.read();return {names:WORLD_KEYS.filter(k=>!!v?.[k]),available:true};}catch{return {names:[],available:false};}
 }
 async keys():Promise<WorldKeys>{try{return (await this.read())??{};}catch{return {};}}
 /** Merges keys found in v9's server.py; returns the names imported. */
 async importV9(source:string):Promise<WorldKey[]>{
  const found=keysFromV9(source);const names=Object.keys(found) as WorldKey[];if(!names.length)return [];
  await this.save({...await this.keys(),...found});return names;
 }
}
