/** The owner's private details, kept out of the code and out of git: data/profile.json (the data folder is ignored).
 * Today it holds the job-scout résumé; anything personal that HARMONY needs as a default belongs here rather than in
 * the source. A missing or broken file just means no profile: every feature that needs one stays off or asks. */
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {JobProfile} from './job-scout.ts';

/** home: the owner's town or city ("Portland, Oregon"), with optional coordinates for feeds that need a point.
 * Used as the default place for weather, watch zones and local feeds. Unset means HARMONY asks instead of guessing. */
export interface OwnerHome {place:string;lat?:number;lon?:number;}
export interface OwnerProfile {job?:Partial<JobProfile>;home?:OwnerHome;}
const text=(v:unknown,n:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n):undefined;

export function readProfile(root:string):OwnerProfile{
 try{
  const path=join(root,'data','profile.json');if(!existsSync(path))return {};
  const raw=JSON.parse(readFileSync(path,'utf8')) as {job?:Record<string,unknown>;home?:Record<string,unknown>};
  const out:OwnerProfile={};
  const h=raw?.home&&typeof raw.home==='object'?raw.home:null;
  if(h){
   const place=text(h.place,120);
   if(place){
    const home:OwnerHome={place};
    const num=(v:unknown,lim:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=lim?v:undefined;
    const lat=num(h.lat,90),lon=num(h.lon,180);
    if(lat!==undefined&&lon!==undefined){home.lat=lat;home.lon=lon;}
    out.home=home;
   }
  }
  const j=raw?.job&&typeof raw.job==='object'?raw.job:null;if(!j)return out;
  const job:Partial<JobProfile>={};
  for(const [k,n] of [['name',80],['wants',900],['experience',900],['skills',900],['minPay',60],['avoid',900]] as const){const v=text(j[k],n);if(v)job[k]=v;}
  if(typeof j.enabled==='boolean')job.enabled=j.enabled;
  out.job=job;return out;
 }catch{return {};}
}
