/** What the chamber shows: upcoming reminders and timers, and fired ones not yet dismissed. */
export interface RemindersStatus {
 upcoming:{id:string;kind:'reminder'|'timer';text:string;dueAt:string}[];
 alerts:{id:string;kind:'reminder'|'timer';text:string;dueAt:string;firedAt:string;late:boolean}[];
}
export const emptyReminders:RemindersStatus={upcoming:[],alerts:[]};
