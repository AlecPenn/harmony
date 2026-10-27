/** Phase 38, smart arrival: when you come back after a while (unlocking Windows, or the keyboard and mouse waking up after
 * 30+ minutes idle), HARMONY says something only if there's something worth saying. No greeting for its own sake. */
export interface ArrivalFacts {awayMinutes:number;missedReminders:readonly string[];readyResearch:readonly string[];nextEvent:{title:string;minutes:number}|null;newNotices:number;}
export const AWAY_MINUTES=30;

export function arrivalSummary(f:ArrivalFacts):string|null{
 if(f.awayMinutes<AWAY_MINUTES)return null;
 const parts:string[]=[];
 if(f.missedReminders.length)parts.push(f.missedReminders.length===1?`while you were away I reminded you: ${f.missedReminders[0]}`:`you missed ${f.missedReminders.length} reminders, the last was ${f.missedReminders.at(-1)}`);
 if(f.nextEvent&&f.nextEvent.minutes>=0&&f.nextEvent.minutes<=45)parts.push(`${f.nextEvent.title} starts in ${f.nextEvent.minutes<=1?'a minute':`${f.nextEvent.minutes} minutes`}`);
 if(f.readyResearch.length)parts.push(f.readyResearch.length===1?`your research on ${f.readyResearch[0]} is ready`:`${f.readyResearch.length} research reports are ready`);
 if(!parts.length&&f.newNotices>=3)parts.push(`there are ${f.newNotices} notices on screen`);
 if(!parts.length)return null;
 const text=parts.length===1?parts[0]:`${parts.slice(0,-1).join(', ')}, and ${parts.at(-1)}`;
 return `Welcome back. ${text[0].toUpperCase()}${text.slice(1)}.`;
}

/** Tracks when you were last active. Feed it the system idle time (seconds) every minute and unlock events. */
export class ArrivalTracker {
 #awaySince:number|null=null;
 private arrive:(awayMinutes:number)=>void;private now:()=>number;
 constructor(arrive:(awayMinutes:number)=>void,now:()=>number=Date.now){this.arrive=arrive;this.now=now;}
 /** Idle seconds from the OS. Going idle for 30+ minutes marks you away; activity after that is an arrival. */
 idle(seconds:number){
  if(!Number.isFinite(seconds)||seconds<0)return;
  if(seconds>=AWAY_MINUTES*60){if(this.#awaySince===null)this.#awaySince=this.now()-seconds*1000;return;}
  if(this.#awaySince!==null&&seconds<120)this.#back();
 }
 locked(){if(this.#awaySince===null)this.#awaySince=this.now();}
 unlocked(){if(this.#awaySince!==null)this.#back();}
 #back(){const minutes=Math.round((this.now()-this.#awaySince!)/60000);this.#awaySince=null;try{this.arrive(minutes);}catch{}}
}
