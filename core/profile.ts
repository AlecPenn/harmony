/** The owner's private details, kept out of the code and out of git: data/profile.json (the data folder is ignored).
 * Today it holds the job-scout résumé; anything personal that HARMONY needs as a default belongs here rather than in
 * the source. A missing or broken file just means no profile: every feature that needs one stays off or asks. */
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {JobProfile} from './job-scout.ts';

/** home: the owner's town or city ("Portland, Oregon"), with optional coordinates for feeds that need a point.
 * Used as the default place for weather, watch zones and local feeds. Unset means HARMONY asks instead of guessing. */
export interface OwnerHome {place:string;lat?:number;lon?:number;}
export interface OwnerProfile {job?:Partial<JobProfile>;home?:OwnerHome;}
const text=(v:unknown,n:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n):undefined;

/** Save a home without discarding other private profile fields. Refuse to overwrite an unreadable profile. */
export function writeHome(root:string,input:OwnerHome,dataDir=join(root,'data')):OwnerHome{
 const place=text(input?.place,120);if(!place||place.length<2)throw new Error('Enter a town or city.');
 const {lat,lon}=input;
 if((lat===undefined)!==(lon===undefined)|| (lat!==undefined&&(!Number.isFinite(lat)||Math.abs(lat)>90)) || (lon!==undefined&&(!Number.isFinite(lon)||Math.abs(lon)>180)))throw new Error('Enter both valid coordinates, or leave both blank.');
 const dir=dataDir,path=join(dir,'profile.json');let raw:Record<string,unknown>={};
 if(existsSync(path)){const value:unknown=JSON.parse(readFileSync(path,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The existing profile is not an object.');raw=value as Record<string,unknown>;}
 const home:OwnerHome={place,...(lat!==undefined&&lon!==undefined?{lat,lon}:{})};raw.home=home;
 mkdirSync(dir,{recursive:true});const temp=join(dir,`.profile-${randomUUID()}.tmp`);
 try{writeFileSync(temp,JSON.stringify(raw,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,path);}finally{if(existsSync(temp))unlinkSync(temp);}
 return home;
}

export function readProfile(root:string,dataDir=join(root,'data')):OwnerProfile{
 try{
  const path=join(dataDir,'profile.json');if(!existsSync(path))return {};
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
