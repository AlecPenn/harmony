/** Current local date and time as a short line the model can read.
 * It is attached to each new user message (never the fixed instructions) so the cached prompt prefix stays valid.
 */
export function localTimeLine(now:Date=new Date(),timeZone?:string):string{
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('Invalid time');
 const zone=timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone;
 const when=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'}).format(now);
 return `(Current local time: ${when}, ${zone})`;
}
/** The exact user content sent to the model: time line, then what the person said. */
export function withTime(text:string,now:Date=new Date(),timeZone?:string):string{return `${localTimeLine(now,timeZone)}\n${text}`;}
