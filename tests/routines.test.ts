import {expect,it} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {draft,describeSteps,RoutineStore,TEACH,phraseKey} from '../core/routines.ts';
import {AssistantActions} from '../core/assistant-actions.ts';
import {ReminderStore} from '../core/reminders.ts';
import {SkillRegistry} from '../core/skills.ts';
import {WebLookup} from '../core/web.ts';

const fakeShortcut=(t:string)=>/^(triage|check) my (email|inbox)$/i.test(t)?'<tool_call>\n<function=check_email>\n<parameter=query>\ntriage\n</parameter>\n</function>\n</tool_call>'
 :/^lock in$/i.test(t)?'<tool_call>\n<function=set_mode>\n<parameter=mode>\nfocus\n</parameter>\n</function>\n</tool_call>'
 :/^status$/i.test(t)?'<tool_call>\n<function=status_report>\n<parameter=focus>\n\n</parameter>\n</function>\n</tool_call>'
 :/^list skills$/i.test(t)?'<tool_call>\n<function=skills>\n<parameter=action>\nlist\n</parameter>\n<parameter=name>\n\n</parameter>\n</function>\n</tool_call>':null;

it('turns a described routine into known commands, and lists what it didn\'t understand',()=>{
 const m='Teach you a skill: when I say start my day, open Quickbase, triage my email, then the weather in Madison and set a 25 minute timer for focus, and juggle'.match(TEACH)!;
 expect(m[1]).toBe('start my day');
 const d=draft(m[1],m[2],fakeShortcut);
 expect(d.problem).toBeNull();
 expect(d.steps.map(s=>[s.name,s.arguments])).toEqual([
  ['control_computer',{action:'open_app',target:'Quickbase'}],['check_email',{query:'triage'}],['get_weather',{place:'Madison'}],['set_timer',{minutes:'25',label:'focus'}]]);
 expect(d.unknown).toEqual(['juggle']);
 expect(describeSteps(d.steps)).toBe('open Quickbase, triage my email, tell you the weather in Madison and set a 25-minute timer for focus');
 expect(draft('morning','open github.com, say "Good morning, Alex", the weather',fakeShortcut)).toMatchObject({steps:[{name:'control_computer',arguments:{action:'open_website',target:'github.com'}},{name:'say',arguments:{text:'Good morning, Alex'}}],unknown:['the weather (say which town, like "the weather in Madison")']});
 // A phrase that already means something, a skill that changes skills, or nothing usable is refused.
 expect(draft('status','lock in',fakeShortcut).problem).toMatch(/already means something/);
 expect(draft('my skills','list skills',fakeShortcut)).toMatchObject({steps:[],unknown:['list skills']});
 expect(draft('x y','dance a jig',fakeShortcut).problem).toMatch(/couldn't turn any/);
 expect(draft('lots','lock in, lock in, lock in, lock in, lock in, lock in, lock in',fakeShortcut).problem).toMatch(/more than 6 steps/);
 expect(phraseKey('Harmony, Start my day!')).toBe('start my day');
 for(const bad of ['teach you a skill','when I say go, open x','what skills do you have'])expect(TEACH.test(bad)).toBe(false);
});
it('drafts never run; approved ones match only their exact phrase; forgetting and restoring',()=>{
 const s=new RoutineStore(openDatabase(':memory:'),()=>new Date(2026,9,22));
 const r=s.add(draft('start my day','lock in, triage my email',fakeShortcut));
 expect(r.status).toBe('draft');expect(s.match('start my day')).toBeNull();
 expect(s.approve(r.id)).toBe(true);expect(s.approve(r.id)).toBe(false);
 expect(s.match('Harmony, start my day.')?.id).toBe(r.id);expect(s.match('start my day please')).toBeNull();
 // Teaching the same phrase again replaces it, as a new draft.
 const again=s.add(draft('start my day','lock in',fakeShortcut));expect(s.list()).toHaveLength(1);expect(s.match('start my day')).toBeNull();
 expect(s.find('the skill start my day')?.id).toBe(again.id);expect(s.remove(again.id)).toBe(true);s.restore(again);expect(s.list()).toHaveLength(1);
});
it('by voice: teach (saved as a draft, undoable), refuse to run until approved, then run each step through the usual checks',async()=>{
 const db=openDatabase(':memory:'),now=()=>new Date(2026,9,22,9),routines=new RoutineStore(db,now);
 const a=new AssistantActions(new ReminderStore(db,now),db,()=>{},now,null,new WebLookup(),null,null,null,null,null,{skills:new SkillRegistry(db),routines,modes:new (await import('../core/modes.ts')).ModeStore(db)});
 const sig=new AbortController().signal,say=async(text:string)=>{const m=a.shortcut(text);expect(m,text).toBeTruthy();const name=m!.match(/<function=(\w+)>/)![1],args:Record<string,string>={};for(const x of m!.matchAll(/<parameter=(\w+)>\n([\s\S]*?)\n<\/parameter>/g))args[x[1]]=x[2];return a.run([{name,arguments:args}],sig);};
 const taught=await say('Harmony, teach you a skill: when I say game time, lock in, say "Let\'s go", then set a 20 minute timer for warmup');
 expect(taught.spoken).toBe('Saved as a draft. When you say "game time", I\'ll focus mode, say "Let\'s go" and set a 20-minute timer for warmup. Read it over and approve it in Settings, under taught skills, before I\'ll run it.'.replace('focus mode','lock in'));
 expect(a.shortcut('game time')).toBeNull(); // a draft isn't a command yet
 const r=routines.list()[0];expect(routines.approve(r.id)).toBe(true);
 const ran=await say('game time');
 expect(ran.spoken).toMatch(/Locked in\..*Let's go.*20 minute/s);expect(routines.get(r.id)?.runs).toBe(1);
 expect(new (await import('../core/modes.ts')).ModeStore(db).status().mode).toBe('focus');
 const forgot=await say('forget the skill game time');expect(forgot.spoken).toMatch(/Forgot "game time"/);expect(routines.list()).toHaveLength(0);
});
