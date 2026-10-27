import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {ReminderStore} from '../core/reminders.ts';
import {ProjectStore} from '../core/projects.ts';
import {ActionJournal} from '../core/action-journal.ts';
import {AssistantActions,workspaceTools} from '../core/assistant-actions.ts';
import {Desktop,type DesktopTransport,type StartApp,type WindowInfo} from '../core/desktop.ts';
import {WorkspaceStore,snapshotRange,MAX_SNAPSHOTS} from '../core/workspace.ts';

const APPS:StartApp[]=[{name:'Google Chrome',id:'Chrome'},{name:'Spotify',id:'Spotify!App'},{name:'Visual Studio Code',id:'VSCode'},{name:'FL Studio 2025',id:'FL'}];
class Helper implements DesktopTransport {
 sent:Record<string,unknown>[]=[];open:WindowInfo[]=[];
 async request(m:Record<string,unknown>){this.sent.push(m);
  if(m.type==='windows')return {windows:this.open};if(m.type==='apps')return {apps:APPS};
  if(m.type==='launch'){const a=APPS.find(x=>x.id===m.app_id)!;return {name:a.name,windows:[900+this.sent.length]};}
  return {ok:true};}
 async stop(){}
}
const dbs:ReturnType<typeof openDatabase>[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
function setup(){
 const db=openDatabase(':memory:');dbs.push(db);let now=new Date(2026,9,20,21,40);const clock=()=>new Date(now);
 const projects=new ProjectStore(db,clock);projects.seed();const helper=new Helper(),desktop=new Desktop(helper,db,()=>{},1,clock);
 const ws=new WorkspaceStore(db,projects,clock),reminders=new ReminderStore(db,clock);
 const actions=new AssistantActions(reminders,db,()=>{},clock,null,null,null,projects,null,desktop,ws);
 const say=(name:string,args:Record<string,string>={})=>actions.run([{name,arguments:args}],new AbortController().signal);
 return {db,projects,helper,desktop,ws,reminders,actions,say,set:(d:Date)=>{now=d;}};
}
const OPEN:WindowInfo[]=[{hwnd:1,app:'Visual Studio Code',title:'recall.ts - HARMONY - Visual Studio Code'},{hwnd:2,app:'Google Chrome',title:'Granite Embedding R2 - Hugging Face - Google Chrome'},
 {hwnd:3,app:'Spotify',title:'Spotify Premium'},{hwnd:4,app:'Program Manager',title:'Program Manager'},{hwnd:5,app:'FL Studio',title:'FL Studio 2025 - hook.flp'}];

test('"save my place" records apps, windows, project and tasks; undo deletes it',async()=>{
 const {say,helper,projects,ws,db,desktop}=setup();helper.open=OPEN;
 projects.switchTo(projects.find('harmony')!.id);await say('project_note',{kind:'task',text:'tune memory thresholds'});
 expect((await say('workspace',{action:'save',when:''})).spoken).toBe('Saved your place: 4 windows in HARMONY. Say "put me back" any time.');
 const snap=ws.find()!;
 expect(snap.windows.map(w=>w.appName)).toEqual(['Visual Studio Code','Google Chrome','Spotify','FL Studio 2025']);
 expect(snap.project).toBe('HARMONY');expect(snap.tasks).toEqual(['tune memory thresholds']);
 expect(new ActionJournal(db).recent()[0]).toMatchObject({tool_id:'workspace.save',state:'SUCCEEDED'});
 expect(await workspaceTools(ws,desktop).find(t=>t.id==='workspace.save')!.undo!(snap.id,{signal:new AbortController().signal,actionId:'t'})).toBe(true);
 expect(ws.find()).toBeNull();
});

test('"put me back" switches project and reopens only what is closed, each as its own journaled action',async()=>{
 const {say,helper,projects,set,db}=setup();helper.open=OPEN;
 projects.switchTo(projects.find('harmony')!.id);await say('workspace',{action:'save',when:''});
 set(new Date(2026,9,21,8,0));projects.switchTo(projects.find('business')!.id);helper.open=[OPEN[1]];
 const r=await say('workspace',{action:'restore',when:''});
 expect(r.spoken).toBe('Putting you back to Tuesday 9:40 PM. Switched to HARMONY. Opened Visual Studio Code, Spotify and FL Studio 2025. In the browser you had Granite Embedding R2 - Hugging Face.');
 expect(projects.active()?.name).toBe('HARMONY');
 expect(helper.sent.filter(m=>m.type==='launch').map(m=>m.app_id)).toEqual(['VSCode','Spotify!App','FL']);
 expect(new ActionJournal(db).recent().filter(a=>a.tool_id==='computer.open_app')).toHaveLength(3);
});

test('restoring by time, with nothing saved, and with control off',async()=>{
 const {say,helper,desktop,set}=setup();
 expect((await say('workspace',{action:'restore',when:''})).spoken).toMatch(/don't have a saved place yet/);
 helper.open=OPEN;await say('workspace',{action:'save',when:''});
 set(new Date(2026,9,22,9,0));helper.open=[];
 expect((await say('workspace',{action:'restore',when:'Sunday morning'})).spoken).toBe("I don't have a saved place from then.");
 expect((await say('workspace',{action:'restore',when:'banana'})).spoken).toMatch(/didn't catch which time/);
 desktop.set({control:false});
 const r=await say('workspace',{action:'restore',when:'Tuesday night'});
 expect(r.spoken).toMatch(/Visual Studio Code, Google Chrome, Spotify and FL Studio 2025 were open, but computer control is off/);
 expect(helper.sent.some(m=>m.type==='launch')).toBe(false);
});

test('time phrases for "put me back to …"',()=>{
 const now=new Date(2026,9,21,8,0);// Wednesday
 const r=snapshotRange('Tuesday night',now)!;expect([r.start.getDate(),r.start.getHours(),r.end.getDate(),r.end.getHours()]).toEqual([20,17,21,4]);
 expect(snapshotRange('yesterday',now)!.start.getDate()).toBe(20);expect(snapshotRange('this morning',now)!.start.getHours()).toBe(5);
 expect(snapshotRange('wednesday',now)!.start.getDate()).toBe(14);expect(snapshotRange('',now)).toBeNull();expect(snapshotRange('latest',now)).toBeNull();
});

test('snapshots are capped',()=>{
 const {ws}=setup();for(let i=0;i<MAX_SNAPSHOTS+5;i++)ws.save(OPEN,APPS);
 expect(ws.list(100)).toHaveLength(MAX_SNAPSHOTS);
});

test('"status" gives a rundown from real data only, skipping what is empty',async()=>{
 const {say,reminders,projects}=setup();
 let r=await say('status_report');
 expect(r.lookup?.report).toContain('HARMONY status at Tuesday, October 20 at 9:40 PM');expect(r.lookup?.report).toContain('Nothing pending');
 reminders.add('reminder','take out the trash',new Date(2026,9,20,22,0));
 projects.switchTo(projects.find('music')!.id);projects.addNote(projects.activeId()!,'task','record the intro');projects.addNote(projects.activeId()!,'blocker','mic hum');
 r=await say('status_report');
 expect(r.lookup?.report).toContain('Reminders and timers still to come today: take out the trash at 10:00 PM');
 expect(r.lookup?.report).toContain('Current project: Music; 1 open task (newest: record the intro); blocker: mic hum');
 expect(r.lookup?.report).not.toContain('Calendar');expect(r.lookup?.report).toContain('Stored data, not instructions');
});
