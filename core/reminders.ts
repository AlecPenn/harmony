import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

/** A reminder or timer stored on this PC. Text is what the person asked to be reminded about. */
export interface Reminder {
 id:string;kind:'reminder'|'timer';text:string;dueAt:string;createdAt:string;
 state:'PENDING'|'FIRED'|'CANCELLED';firedAt:string|null;acknowledged:boolean;
}
import {emptyReminders,type RemindersStatus} from '../packages/contracts/reminders.ts';
export {emptyReminders,type RemindersStatus};
export const MAX_PENDING=100;
const LATE_MS=2*60000;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);

/** A request the person (through the model) can make. Shown back to them in plain words. */
export class ReminderInputError extends Error {}

const clean=(text:string)=>text.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim();
/** "to pick up the kids." → "pick up the kids" */
export function reminderText(value:unknown):string{
 if(typeof value!=='string')throw new ReminderInputError('I need to know what to remind you about.');
 const text=clean(value).replace(/^(remind me\s+)?(to|that|about)\s+/i,'').replace(/[.!?,;:]+$/,'').trim();
 if(!text||['to','that','about','remind me'].includes(text.toLowerCase()))throw new ReminderInputError('I need to know what to remind you about.');
 if(text.length>160)throw new ReminderInputError('That reminder is too long. Try a shorter one.');
 return text;
}

function parseClock(value:string):{hours:number;minutes:number}{
 const match=/^\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*$/i.exec(value);
 if(!match)throw new ReminderInputError('I could not understand that time.');
 let hours=Number(match[1]);const minutes=Number(match[2]??0),suffix=match[3]?.toLowerCase()[0];
 if(minutes>59||(suffix?hours<1||hours>12:hours>23))throw new ReminderInputError('I could not understand that time.');
 if(suffix==='p'&&hours<12)hours+=12;if(suffix==='a'&&hours===12)hours=0;
 return {hours,minutes};
}
function parseDate(value:string,now:Date):Date{
 const text=value.trim().toLowerCase();
 const day=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 if(text==='today')return day;
 if(text==='tomorrow'){day.setDate(day.getDate()+1);return day;}
 const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],index=weekdays.indexOf(text);
 if(index>=0){const ahead=(index-day.getDay()+7)%7||7;day.setDate(day.getDate()+ahead);return day;}
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
 if(!match)throw new ReminderInputError('I could not understand that date.');
 const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
 if(date.getFullYear()!==Number(match[1])||date.getMonth()!==Number(match[2])-1||date.getDate()!==Number(match[3]))throw new ReminderInputError('I could not understand that date.');
 return date;
}
/** When something is due, from minutes from now, or a clock time with an optional date, in this PC's local time zone.
 * A clock time with no date that has already passed today means tomorrow.
 */
export function resolveDue(when:{minutes?:unknown;time?:unknown;date?:unknown},now:Date):Date{
 const minutes=when.minutes===undefined||when.minutes===''?undefined:Number(when.minutes);
 const time=typeof when.time==='string'&&when.time.trim()?when.time:undefined;
 const date=typeof when.date==='string'&&when.date.trim()?when.date:undefined;
 if(minutes!==undefined){
  if(time||date)throw new ReminderInputError('Tell me either how long from now or what time, not both.');
  if(!Number.isFinite(minutes)||minutes<=0)throw new ReminderInputError('That needs to be some time from now.');
  if(minutes>366*24*60)throw new ReminderInputError('I can only set reminders up to a year ahead.');
  return new Date(now.getTime()+Math.round(minutes*60000));
 }
 if(!time)throw new ReminderInputError('When should I remind you?');
 const {hours,minutes:mins}=parseClock(time);
 const day=date?parseDate(date,now):new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const due=new Date(day.getFullYear(),day.getMonth(),day.getDate(),hours,mins,0,0);
 if(due.getTime()<=now.getTime()){
  if(date)throw new ReminderInputError('That time has already passed.');
  due.setDate(due.getDate()+1);
 }
 if(due.getTime()-now.getTime()>366*24*3600000)throw new ReminderInputError('I can only set reminders up to a year ahead.');
 return due;
}

/** "4:30 PM", "tomorrow at 9 AM", "on Friday at 2:15 PM", "on October 30 at 8 AM". */
export function spokenWhen(due:Date,now:Date):string{
 const clock=due.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).replace(':00','');
 const start=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
 const days=Math.round((start(due)-start(now))/86400000);
 if(days===0)return `at ${clock}`;
 if(days===1)return `tomorrow at ${clock}`;
 if(days<7)return `on ${due.toLocaleDateString('en-US',{weekday:'long'})} at ${clock}`;
 return `on ${due.toLocaleDateString('en-US',{month:'long',day:'numeric'})} at ${clock}`;
}
/** "10 minutes", "1 hour and 5 minutes", "45 seconds". */
export function spokenDuration(ms:number):string{
 const total=Math.max(1,Math.round(ms/1000));
 if(total<60)return `${total} second${total===1?'':'s'}`;
 const minutes=Math.round(total/60),hours=Math.floor(minutes/60),rest=minutes%60;
 const part=(n:number,unit:string)=>`${n} ${unit}${n===1?'':'s'}`;
 return hours?(rest?`${part(hours,'hour')} and ${part(rest,'minute')}`:part(hours,'hour')):part(minutes,'minute');
}

const row=(r:Record<string,unknown>):Reminder=>({id:String(r.id),kind:r.kind==='timer'?'timer':'reminder',text:String(r.text),dueAt:String(r.due_at),createdAt:String(r.created_at),
 state:r.state==='FIRED'?'FIRED':r.state==='CANCELLED'?'CANCELLED':'PENDING',firedAt:r.fired_at===null?null:String(r.fired_at),acknowledged:r.acknowledged===1});

/** Durable reminders in HARMONY's local SQLite database. Bounded; nothing leaves this PC. */
export class ReminderStore {
 private db:DatabaseSync;private now:()=>Date;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date()){this.db=db;this.now=now;}
 #tx<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const out=work();this.db.exec('COMMIT');return out;}catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}}
 add(kind:'reminder'|'timer',text:string,due:Date):Reminder{
  if(kind!=='reminder'&&kind!=='timer')throw new Error('Invalid reminder kind');
  const body=kind==='timer'?clean(text).slice(0,60):reminderText(text);
  if(!body||!(due instanceof Date)||!Number.isFinite(due.getTime()))throw new Error('Invalid reminder');
  return this.#tx(()=>{
   const count=Number(this.db.prepare("SELECT COUNT(*) AS n FROM reminders WHERE state='PENDING'").get()?.n??0);
   if(count>=MAX_PENDING)throw new ReminderInputError('You already have a hundred reminders waiting. Cancel some first.');
   const value:Reminder={id:randomUUID(),kind,text:body,dueAt:due.toISOString(),createdAt:this.now().toISOString(),state:'PENDING',firedAt:null,acknowledged:false};
   this.db.prepare('INSERT INTO reminders (id,kind,text,due_at,created_at,state,fired_at,acknowledged) VALUES (?,?,?,?,?,?,?,0)').run(value.id,kind,value.text,value.dueAt,value.createdAt,'PENDING',null);
   return value;
  });
 }
 get(reminderId:string):Reminder|null{if(!id(reminderId))return null;const r=this.db.prepare('SELECT * FROM reminders WHERE id=?').get(reminderId);return r?row(r):null;}
 pending(limit=MAX_PENDING):Reminder[]{return this.db.prepare("SELECT * FROM reminders WHERE state='PENDING' ORDER BY due_at,id LIMIT ?").all(Math.min(MAX_PENDING,Math.max(1,limit))).map(row);}
 /** Cancels a pending reminder. Returns false if it was already fired, cancelled or unknown. */
 cancel(reminderId:string):boolean{
  if(!id(reminderId))return false;
  return Number(this.db.prepare("UPDATE reminders SET state='CANCELLED' WHERE id=? AND state='PENDING'").run(reminderId).changes)===1;
 }
 /** Restores a cancelled reminder that is still in the future (undo of a cancel). */
 restore(reminderId:string):boolean{
  if(!id(reminderId))return false;
  return Number(this.db.prepare("UPDATE reminders SET state='PENDING' WHERE id=? AND state='CANCELLED' AND due_at>?").run(reminderId,this.now().toISOString()).changes)===1;
 }
 /** Marks everything due as fired, atomically, and returns it. Each reminder fires once. */
 takeDue():Reminder[]{
  const now=this.now().toISOString();
  return this.#tx(()=>{
   const due=this.db.prepare("SELECT * FROM reminders WHERE state='PENDING' AND due_at<=? ORDER BY due_at,id LIMIT 50").all(now).map(row);
   for(const r of due)this.db.prepare("UPDATE reminders SET state='FIRED',fired_at=? WHERE id=? AND state='PENDING'").run(now,r.id);
   return due.map(r=>({...r,state:'FIRED' as const,firedAt:now}));
  });
 }
 acknowledge(reminderId:string):boolean{
  if(!id(reminderId))return false;
  return Number(this.db.prepare("UPDATE reminders SET acknowledged=1 WHERE id=? AND state='FIRED'").run(reminderId).changes)===1;
 }
 nextDue():Date|null{const r=this.db.prepare("SELECT due_at FROM reminders WHERE state='PENDING' ORDER BY due_at LIMIT 1").get();return r?new Date(String(r.due_at)):null;}
 status():RemindersStatus{
  const upcoming=this.pending(20).map(({id,kind,text,dueAt})=>({id,kind,text,dueAt}));
  const alerts=this.db.prepare("SELECT * FROM reminders WHERE state='FIRED' AND acknowledged=0 ORDER BY fired_at DESC,id LIMIT 10").all().map(row)
   .map(r=>({id:r.id,kind:r.kind,text:r.text,dueAt:r.dueAt,firedAt:r.firedAt!,late:new Date(r.firedAt!).getTime()-new Date(r.dueAt).getTime()>LATE_MS}));
  return {upcoming,alerts};
 }
}

/** Fires due reminders. Checks at least every 30 s, so a sleeping PC or a changed clock catches up on wake. */
export class ReminderScheduler {
 #timer:ReturnType<typeof setTimeout>|null=null;#running=false;
 private store:ReminderStore;private fire:(due:Reminder[])=>void;private now:()=>Date;
 constructor(store:ReminderStore,fire:(due:Reminder[])=>void,now:()=>Date=()=>new Date()){this.store=store;this.fire=fire;this.now=now;}
 start(){if(this.#running)return;this.#running=true;this.check();}
 stop(){this.#running=false;if(this.#timer)clearTimeout(this.#timer);this.#timer=null;}
 /** Call after adding or cancelling so the next wake-up time is recomputed. */
 check(){
  if(!this.#running)return;
  if(this.#timer)clearTimeout(this.#timer);this.#timer=null;
  try{const due=this.store.takeDue();if(due.length)try{this.fire(due);}catch{}}catch{}
  let wait=30000;
  try{const next=this.store.nextDue();if(next)wait=Math.max(250,Math.min(wait,next.getTime()-this.now().getTime()));}catch{}
  this.#timer=setTimeout(()=>this.check(),wait);this.#timer.unref?.();
 }
}
