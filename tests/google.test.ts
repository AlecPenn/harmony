import {test,expect,afterEach} from 'vitest';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GoogleAccount,GoogleError,parseClientFile,calendarRange,GOOGLE_SCOPES} from '../core/google.ts';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {AssistantActions} from '../core/assistant-actions.ts';

const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const client=JSON.stringify({installed:{client_id:'123-abc.apps.googleusercontent.com',client_secret:'GOCSPX-secret',redirect_uris:['http://localhost']}});
// Reversible stand-in for Windows protected storage (bytes reversed and shifted, so plain text never appears on disk).
const cipher={available:async()=>true,encrypt:async(t:string)=>Buffer.from(Buffer.from(t).map(b=>b^0x5a)),decrypt:async(b:Buffer)=>Buffer.from(b.map(x=>x^0x5a)).toString()};
let clock=Date.now();
function setup(route:(url:string,init?:RequestInit)=>{status?:number;body:unknown}|undefined){
 const dir=mkdtempSync(join(tmpdir(),'harmony-google-'));dirs.push(dir);const calls:{url:string;body?:string;auth?:string}[]=[];
 const f=(async(input:any,init?:RequestInit)=>{const url=String(input);calls.push({url,body:init?.body as string|undefined,auth:(init?.headers as Record<string,string>|undefined)?.Authorization});
  const r=route(url,init);if(!r)throw new TypeError('offline');return new Response(JSON.stringify(r.body),{status:r.status??200});}) as typeof fetch;
 return {account:new GoogleAccount(join(dir,'google.enc'),cipher,f,()=>clock),calls,path:join(dir,'google.enc')};
}
const tokenOk={access_token:'ya29.access',expires_in:3599,refresh_token:'1//refresh',scope:`${GOOGLE_SCOPES.calendar} ${GOOGLE_SCOPES.gmail}`,token_type:'Bearer'};
async function signIn(account:GoogleAccount,caps:('calendar'|'gmail')[]=['calendar','gmail']){
 let auth!:URL;
 const status=await account.connect(caps,async url=>{
  auth=new URL(url);const redirect=auth.searchParams.get('redirect_uri')!;
  // Something else poking the loopback port with the wrong state is ignored.
  expect(await (await fetch(`${redirect}/?code=evil&state=wrong`)).text()).toContain('not from HARMONY');
  setTimeout(()=>void fetch(`${redirect}/?code=4/good&state=${auth.searchParams.get('state')}`),5);
 });
 return {status,auth};
}

test('only Desktop-app client files are accepted',()=>{
 expect(parseClientFile(client)).toEqual({clientId:'123-abc.apps.googleusercontent.com',clientSecret:'GOCSPX-secret'});
 expect(()=>parseClientFile(JSON.stringify({web:{client_id:'x.apps.googleusercontent.com'}}))).toThrow(/Desktop app/);
 expect(()=>parseClientFile('not json')).toThrow(GoogleError);
 expect(()=>parseClientFile(JSON.stringify({installed:{client_id:'bad'}}))).toThrow(/client ID/);
});

test('calendar ranges read naturally in local time',()=>{
 const now=new Date(2026,9,20,16,0);  // Tuesday 4 PM
 expect(calendarRange('today',now)).toMatchObject({start:now,end:new Date(2026,9,21)});
 expect(calendarRange('tomorrow',now)).toMatchObject({start:new Date(2026,9,21),end:new Date(2026,9,22)});
 expect(calendarRange('friday',now).start).toEqual(new Date(2026,9,23));
 expect(calendarRange('tuesday',now).start).toEqual(now);
 expect(calendarRange('next tuesday',now).start).toEqual(new Date(2026,9,27));
 expect(calendarRange('next week',now)).toMatchObject({start:new Date(2026,9,26),end:new Date(2026,10,2)});
 expect(calendarRange('2026-11-03',now).start).toEqual(new Date(2026,10,3));
 expect(calendarRange('this week',now).end).toEqual(new Date(2026,9,27));
});

test('sign-in uses loopback + PKCE + state for exactly the chosen scopes, and stores only encrypted data',async()=>{
 const {account,calls,path}=setup(u=>u.includes('oauth2.googleapis.com/token')?{body:tokenOk}:u.includes('/profile')?{body:{emailAddress:'alec@example.com'}}:undefined);
 await expect(account.connect(['calendar'],()=>{})).rejects.toThrow(/client file/);
 await account.importClient(client);
 const {status,auth}=await signIn(account);
 expect(auth.origin+auth.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
 expect(auth.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
 expect(auth.searchParams.get('code_challenge_method')).toBe('S256');expect(auth.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
 expect(auth.searchParams.get('scope')).toBe(`${GOOGLE_SCOPES.calendar} ${GOOGLE_SCOPES.gmail}`);
 expect(auth.searchParams.get('access_type')).toBe('offline');
 const exchange=new URLSearchParams(calls.find(c=>c.url.includes('/token'))!.body);
 expect(exchange.get('code')).toBe('4/good');expect(exchange.get('code_verifier')).toMatch(/^[\w-]{64}$/);expect(exchange.get('redirect_uri')).toBe(auth.searchParams.get('redirect_uri'));
 expect(status).toMatchObject({connected:true,email:'alec@example.com',capabilities:['calendar','gmail']});
 const disk=readFileSync(path).toString('latin1');
 expect(disk).not.toContain('1//refresh');expect(disk).not.toContain('GOCSPX');expect(disk).not.toContain('apps.googleusercontent');
 // A fresh instance reads the saved sign-in back.
 const again=new GoogleAccount(path,cipher,(async()=>{throw new Error('no network');}) as typeof fetch);
 expect(await again.status()).toMatchObject({connected:true,capabilities:['calendar','gmail']});
});

test('declining in the browser and timing out are clear errors; nothing is saved',async()=>{
 const {account}=setup(()=>undefined);await account.importClient(client);
 await expect(account.connect(['gmail'],async url=>{const u=new URL(url);setTimeout(()=>void fetch(`${u.searchParams.get('redirect_uri')}/?error=access_denied&state=${u.searchParams.get('state')}`),5);})).rejects.toThrow(/declined/);
 await expect(account.connect(['gmail'],()=>{},50)).rejects.toThrow(/timed out/);
 expect((await account.status()).connected).toBe(false);
});

test('calendar and mail are read into short, labelled text',async()=>{
 const events={items:[{summary:'Dentist',start:{dateTime:'2026-10-21T09:30:00'},location:'Main St'},{summary:'Cancelled thing',status:'cancelled',start:{dateTime:'2026-10-21T08:00:00'}},{summary:'Garbage day',start:{date:'2026-10-21'}}]};
 const {account,calls}=setup(u=>u.includes('/token')?{body:tokenOk}:u.includes('/profile')?{body:{emailAddress:'a@b.c'}}:u.includes('calendarList')?{body:{items:[{id:'primary@x',primary:true,summary:'Me'},{id:'kids',summary:'Kids',hidden:true}]}}
  :u.includes('/events')?{body:events}:u.includes('/messages?')?{body:{messages:[{id:'msg00001'}],resultSizeEstimate:3}}:u.includes('/messages/msg00001')?{body:{internalDate:String(Date.UTC(2026,9,20,15)),snippet:'Rent is due &amp; late fees apply',payload:{headers:[{name:'From',value:'"Landlord" <l@x.com>'},{name:'Subject',value:'October rent'}]}}}:undefined);
 await account.importClient(client);await signIn(account);
 const cal=await account.calendar(calendarRange('tomorrow',new Date(2026,9,20,16)),new AbortController().signal);
 expect(cal.text).toMatch(/all day: Garbage day[\s\S]*9:30 AM: Dentist at Main St/);expect(cal.text).not.toContain('Cancelled');
 expect(calls.filter(c=>c.url.includes('/events')).length).toBe(1);   // hidden calendar skipped
 expect(calls.filter(c=>c.url.includes('googleapis.com/calendar')).every(c=>c.auth==='Bearer ya29.access')).toBe(true);
 const mail=await account.mail('',new AbortController().signal);
 expect(calls.find(c=>c.url.includes('/messages?'))!.url).toContain(encodeURIComponent('is:unread newer_than:2d'));
 expect(mail.text).toContain('From Landlord');expect(mail.text).toContain('"October rent" — Rent is due & late fees apply');expect(mail.text).toContain('about 3');
 expect(mail.sources[0]).toMatchObject({site:'Gmail',url:'https://mail.google.com/mail/u/0/#all/msg00001'});
});

test('an expired sign-in asks to reconnect; disconnect revokes at Google; forget removes everything',async()=>{
 let expired=false;
 const {account,calls,path}=setup(u=>u.includes('/token')?(expired?{status:400,body:{error:'invalid_grant'}}:{body:{...tokenOk,expires_in:61}}):u.includes('/profile')?{body:{emailAddress:'a@b.c'}}:u.includes('/revoke')?{body:{}}:u.includes('calendarList')?{body:{items:[]}}:undefined);
 await account.importClient(client);await signIn(account);
 expired=true;clock+=2*3600_000;   // access token long expired, so a refresh is needed
 await expect(account.calendar(calendarRange('today'),new AbortController().signal)).rejects.toThrow(/expired. Reconnect/);
 expect(account.snapshot().needsReconnect).toBe(true);
 await account.disconnect();
 expect(new URLSearchParams(calls.find(c=>c.url.includes('/revoke'))!.body).get('token')).toBe('1//refresh');
 expect(account.snapshot()).toMatchObject({connected:false,clientImported:true,needsReconnect:false});
 await account.forget();expect(existsSync(path)).toBe(false);expect(account.snapshot().clientImported).toBe(false);
});

test('Google functions are offered only once that permission is connected, and run read-only',async()=>{
 const {account}=setup(u=>u.includes('/token')?{body:{...tokenOk,scope:GOOGLE_SCOPES.calendar}}:u.includes('calendarList')?{body:{items:[{id:'p',primary:true}]}}:u.includes('/events')?{body:{items:[]}}:undefined);
 const db=openDatabase(':memory:');
 try{
  const actions=new AssistantActions(new ReminderStore(db),db,()=>{},undefined,null,null,account);
  expect(actions.tools.map(t=>t.name)).not.toContain('calendar_events');
  await account.importClient(client);await signIn(account,['calendar']);
  expect(actions.tools.map(t=>t.name)).toContain('calendar_events');expect(actions.tools.map(t=>t.name)).not.toContain('check_email');
  const out=await actions.run([{name:'calendar_events',arguments:{when:'today'}}],new AbortController().signal);
  expect(out.lookup?.report).toContain('Nothing scheduled');expect(out.spoken).toBe('');
  expect((await actions.run([{name:'check_email',arguments:{query:'x'}}],new AbortController().signal)).spoken).toMatch(/Gmail isn't connected yet/);
 }finally{db.close();}
});

test('triage reads: message details with labels, and one message\'s newest text (HTML reduced, quoted history dropped)',async()=>{
 const b64=(s:string)=>Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
 const {account}=setup(url=>{
  if(url.includes('oauth2.googleapis.com/token'))return {body:tokenOk};
  if(url.includes('/profile'))return {body:{emailAddress:'alec@example.com'}};
  if(url.includes('/messages?'))return {body:{messages:[{id:'msg123abc'},{id:'msg456def'}]}};
  if(url.includes('msg123abc?format=metadata'))return {body:{id:'msg123abc',threadId:'th1',internalDate:String(Date.parse('2026-10-22T13:00:00Z')),labelIds:['INBOX','UNREAD','IMPORTANT'],snippet:'Can you confirm Friday?',
   payload:{headers:[{name:'From',value:'"Jordan M" <jordan@acme.example>'},{name:'To',value:'alec@example.com'},{name:'Subject',value:'Unit 214 schedule'}]}}};
  if(url.includes('msg456def?format=metadata'))return {body:{id:'msg456def',threadId:'th2',internalDate:'1',labelIds:['INBOX','CATEGORY_PROMOTIONS'],snippet:'50% off',payload:{headers:[{name:'From',value:'Shop <deals@shop.example>'},{name:'List-Unsubscribe',value:'<mailto:x>'}]}}};
  if(url.includes('msg123abc?format=full'))return {body:{payload:{mimeType:'multipart/alternative',parts:[{mimeType:'text/html',body:{data:b64('<p>Hi Alec,</p><p>Can you confirm <b>Friday</b> for 214?</p><style>x{}</style>')}}]}}};
  return undefined;
 });
 await account.importClient(client);await signIn(account,['gmail']);
 const list=await account.messages('in:inbox is:unread',10);
 expect(list[0]).toMatchObject({id:'msg123abc',threadId:'th1',from:'Jordan M',fromEmail:'jordan@acme.example',subject:'Unit 214 schedule',labels:['INBOX','UNREAD','IMPORTANT'],bulk:false});
 expect(list[1]).toMatchObject({bulk:true,subject:'(no subject)'});
 expect(await account.messageText('msg123abc')).toBe('Hi Alec,\n Can you confirm Friday for 214?');
 await expect(account.messageText('../../etc')).rejects.toThrow();
});
