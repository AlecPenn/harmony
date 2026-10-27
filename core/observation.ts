import {ERROR,type Desktop} from './desktop.ts';
import type {InterruptionEngine} from './interruptions.ts';

/** Phase 29, active observation, only when chosen in Settings ("Watch for errors"). Every couple of minutes it reads the
 * window in use and, if an error line appears that wasn't there last time in that window, raises a notice. The interruption
 * engine decides what happens (normally shown, not spoken). Nothing is kept except the last few lines per window title. */
export class ScreenWatcher {
 #timer:ReturnType<typeof setInterval>|null=null;#seen=new Map<string,Set<string>>();#busy=false;
 private desktop:Desktop;private engine:InterruptionEngine;private paused:()=>boolean;
 constructor(desktop:Desktop,engine:InterruptionEngine,paused:()=>boolean=()=>false){this.desktop=desktop;this.engine=engine;this.paused=paused;}
 start(everyMs=120000){if(!this.#timer){this.#timer=setInterval(()=>{void this.check();},everyMs);this.#timer.unref?.();}}
 stop(){if(this.#timer)clearInterval(this.#timer);this.#timer=null;this.#seen.clear();}
 async check():Promise<string[]>{
  if(this.#busy||this.paused()||this.desktop.settings.screen!=='watch')return [];this.#busy=true;
  try{
   let look;try{look=await this.desktop.glance();}catch{return [];}
   if(!look?.found||!look.ocr)return [];
   const key=`${look.app}|${look.title.replace(/\d+/g,'#')}`.slice(0,200);
   const errors=look.text.split('\n').map(l=>l.trim()).filter(l=>l.length>6&&l.length<300&&ERROR.test(l));
   const before=this.#seen.get(key);this.#seen.set(key,new Set(errors));
   if(this.#seen.size>50)this.#seen.delete(this.#seen.keys().next().value!);
   // The first look at a window only learns what's already there: errors you've seen before aren't news.
   if(!before)return [];
   const fresh=errors.filter(e=>!before.has(e)).slice(0,2);
   for(const e of fresh)this.engine.raise({source:'screen',key:`screen:${key}:${e.slice(0,80)}`,text:`New on screen in ${look.app||'that window'}: ${e.slice(0,160)}`,
    importance:.55,urgency:.5,confidence:.7,relevance:.7,expiresAt:Date.now()+15*60000});
   return fresh;
  }finally{this.#busy=false;}
 }
}
