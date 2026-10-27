/** Step 22: offline mode. Knows when the internet is down (two failed checks in a row, so a hiccup doesn't count) and
 * when it's back (one good check). Checks every minute, and straight away when a lookup fails. HARMONY announces each
 * change once, keeps everything local working, and saves web questions for when it's back. */
export interface ConnectivityStatus {online:boolean;since:string;lastCheck:string|null;}
export class Connectivity {
 #online=true;#since:number;#last:number|null=null;#fails=0;#checking:Promise<boolean>|null=null;#timer:ReturnType<typeof setInterval>|null=null;
 private probe:()=>Promise<boolean>;private onChange:(online:boolean,downMs:number)=>void;private now:()=>number;
 constructor(probe:()=>Promise<boolean>,onChange:(online:boolean,downMs:number)=>void,now:()=>number=Date.now){this.probe=probe;this.onChange=onChange;this.now=now;this.#since=now();}
 get online(){return this.#online;}
 status():ConnectivityStatus{return {online:this.#online,since:new Date(this.#since).toISOString(),lastCheck:this.#last===null?null:new Date(this.#last).toISOString()};}
 check():Promise<boolean>{
  if(this.#checking)return this.#checking;
  this.#checking=(async()=>{
   let ok=false;try{ok=await this.probe();}catch{ok=false;}
   this.#last=this.now();
   if(ok){this.#fails=0;if(!this.#online){const down=this.now()-this.#since;this.#online=true;this.#since=this.now();try{this.onChange(true,down);}catch{}}}
   else if(++this.#fails>=2&&this.#online){this.#online=false;this.#since=this.now();try{this.onChange(false,0);}catch{}}
   return this.#online;
  })().finally(()=>{this.#checking=null;});
  return this.#checking;
 }
 /** Something network-y just failed: check now (and once more shortly, to confirm). */
 failed(){void this.check().then(on=>{if(on&&this.#fails===1)setTimeout(()=>{void this.check();},3000).unref?.();});}
 start(everyMs=60000){if(this.#timer)return;this.#timer=setInterval(()=>{void this.check();},everyMs);this.#timer.unref?.();}
 stop(){if(this.#timer)clearInterval(this.#timer);this.#timer=null;}
}
/** Plain words for the change. */
export function connectivityText(online:boolean,downMs:number,queued:number):string{
 if(!online)return 'The internet just went down. I\'ll keep going on this PC: conversation, memory, reminders, projects and your work log all still work. Web questions will wait until it\'s back.';
 const mins=Math.round(downMs/60000),dur=mins<2?'':mins<90?` after ${mins} minutes`:` after ${Math.round(mins/60)} hours`;
 return `The internet is back${dur}.${queued?` I'm looking up the ${queued===1?'thing':`${queued} things`} you asked while it was down, and I'll tell you when ${queued===1?'it\'s':'they\'re'} ready.`:''}`;
}
/** Questions that need the internet, and what HARMONY says about each while offline. */
export const NEEDS_INTERNET:Record<string,'queue'|'later'>={web_search:'queue',get_news:'queue',get_weather:'later',check_email:'later',calendar_events:'later',gods_eye:'later'};
