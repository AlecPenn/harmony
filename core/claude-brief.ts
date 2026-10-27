import {existsSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

/** Claude's daily brief (Alec's idea, October 22). A Claude scheduled task writes a short brief before 5 AM into
 * handoff/brief/brief-YYYY-MM-DD.json: the day's weather, the news worth knowing, anything touching Alec's work, and
 * one good thing. HARMONY reads it out after her own morning brief, or when asked "read me my daily brief".
 *
 * Like Spiral Time results, the file is only text to read: it's checked, cleaned of markup and length-limited, and
 * nothing in it can make HARMONY do anything. Only today's file is used. */

export interface ClaudeBrief {date:string;spoken:string;sections:{heading:string;text:string}[];sources:{title:string;url:string}[];}
const MAX_FILE=100_000;
const clean=(v:unknown,n:number)=>String(v??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g,' ').replace(/<\/?[a-z_][^>]*>/gi,'').replace(/[*_#`]+/g,'').replace(/[ \t]+/g,' ').trim().slice(0,n);
export const localDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function parseBrief(text:string,date:string):ClaudeBrief|null{
 let v:Record<string,unknown>;try{v=JSON.parse(text.replace(/^﻿/,''));}catch{return null;}
 if(!v||typeof v!=='object'||v.v!==1||v.date!==date)return null;
 const spoken=clean(v.spoken,1600);if(spoken.length<40)return null;
 const sections=(Array.isArray(v.sections)?v.sections:[]).slice(0,8).flatMap(s=>{const o=(s??{}) as Record<string,unknown>,h=clean(o.heading,60),t=clean(o.text,1200);return h&&t?[{heading:h,text:t}]:[];});
 const sources=(Array.isArray(v.sources)?v.sources:[]).slice(0,12).flatMap(s=>{const o=(s??{}) as Record<string,unknown>;try{const u=new URL(String(o.url??''));return u.protocol==='https:'||u.protocol==='http:'?[{title:clean(o.title,120)||u.hostname,url:u.href.slice(0,500)}]:[];}catch{return [];}});
 return {date,spoken,sections,sources};
}
export class ClaudeBriefs {
 private dir:string;private now:()=>Date;
 constructor(dir:string,now:()=>Date=()=>new Date()){this.dir=dir;this.now=now;}
 get folder(){return join(this.dir,'brief');}
 /** Today's brief, if Claude has written it. */
 today():ClaudeBrief|null{
  const date=localDate(this.now()),file=join(this.folder,`brief-${date}.json`);
  try{if(!existsSync(file)||statSync(file).size>MAX_FILE)return null;return parseBrief(readFileSync(file,'utf8'),date);}catch{return null;}
 }
 /** For "read me my daily brief": the brief, or a plain line saying it isn't here yet. */
 spoken():string{
  const b=this.today();if(b)return b.spoken;
  return this.now().getHours()<5?'Claude writes your daily brief just before 5 AM. It isn\'t here yet.':'There\'s no daily brief from Claude today. The PC may have been asleep or offline at 4:40, or the usage limit was reached.';
 }
}
