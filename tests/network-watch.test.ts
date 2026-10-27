import {expect,it} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {NetworkWatch,parseScan,privateMac,alertText,type Scan} from '../core/network-watch.ts';
import {AssistantActions} from '../core/assistant-actions.ts';
import {ReminderStore} from '../core/reminders.ts';

const raw=(devices:unknown,extra:Record<string,unknown>={})=>JSON.stringify({ok:true,ssid:'Penn Home',adapter:'Wi-Fi',me:'192.168.1.20',prefix:24,gateway:'192.168.1.1',gatewayMac:'AA-BB-CC-00-00-01',devices,...extra});
const dev=(n:number,mac=`10-20-30-40-50-${n.toString(16).padStart(2,'0')}`,name:string|null=null)=>({ip:`192.168.1.${n}`,mac,state:'Reachable',name});

it('reads the scan script\'s output and drops what isn\'t a device',()=>{
 const s=parseScan('﻿'+raw([dev(1,'AA-BB-CC-00-00-01'),dev(20),dev(30,'01-00-5E-00-00-FB'),dev(31,'FF-FF-FF-FF-FF-FF'),dev(32,'33-33-00-00-00-01'),{ip:'999.1.1.1',mac:'10-20-30-40-50-60'},{ip:'192.168.1.40',mac:'<script>'},dev(20)])) as Scan;
 expect(s.devices.map(d=>d.ip)).toEqual(['192.168.1.1','192.168.1.20']);expect(s.devices[0].mac).toBe('aa:bb:cc:00:00:01');
 expect(s.ssid).toBe('Penn Home');expect(s.gatewayMac).toBe('aa:bb:cc:00:00:01');
 // A single device comes back from PowerShell as an object, not a list.
 expect((parseScan(raw(dev(5))) as Scan).devices).toHaveLength(1);
 expect(parseScan('{"ok":false,"reason":"no network"}')).toEqual({error:'This PC isn\'t on a network.'});
 expect(parseScan('garbage')).toHaveProperty('error');expect(parseScan(raw([],{gateway:'x'}))).toHaveProperty('error');
 expect(privateMac('da:a1:19:00:00:01')).toBe(true);expect(privateMac('10:20:30:40:50:60')).toBe(false);
});
it('learns a network quietly the first time, then alerts once per new device; naming or clearing it',()=>{
 const clock={t:Date.parse('2026-10-22T18:00:00Z')},w=new NetworkWatch(openDatabase(':memory:'),()=>new Date(clock.t));
 const scan=(devices:unknown[])=>w.record(parseScan(raw(devices)) as Scan);
 expect(scan([dev(1,'AA-BB-CC-00-00-01'),dev(20),dev(33,'10-20-30-40-50-21','Roku.lan')])).toEqual({fresh:[],learned:3});
 expect(w.view().devices.find(d=>d.ip==='192.168.1.1')?.label).toBe('Router');expect(w.view().devices.find(d=>d.ip==='192.168.1.20')?.label).toBe('This PC');
 clock.t+=300000;expect(scan([dev(1,'AA-BB-CC-00-00-01'),dev(20),dev(33,'10-20-30-40-50-21')]).fresh).toEqual([]);
 const r=scan([dev(1,'AA-BB-CC-00-00-01'),dev(20),dev(44,'DA-A1-19-00-00-01')]);
 expect(r.fresh.map(d=>d.ip)).toEqual(['192.168.1.44']);expect(alertText(r.fresh,'Penn Home')).toBe('A new device joined "Penn Home": a phone or tablet (private address) at 192.168.1.44. If you don\'t know it, check your router.');
 clock.t+=300000;expect(scan([dev(44,'DA-A1-19-00-00-01'),dev(1,'AA-BB-CC-00-00-01')]).fresh).toEqual([]); // only once
 expect(w.spoken()).toMatch(/^4 devices are on "Penn Home" right now\. 1 I don't know yet: a phone or tablet/);
 expect(w.label('da:a1:19:00:00:01','Jordan\'s phone')).toBe(true);
 expect(w.view().devices.find(d=>d.ip==='192.168.1.44')).toMatchObject({label:'Jordan\'s phone',status:'known',online:true,private:true});
 expect(w.spoken()).toMatch(/including Jordan's phone\. None I don't know\./);
 // Away devices age out of "here now"; forgetting one makes it new again next time.
 clock.t+=20*60000;expect(w.view().devices.find(d=>d.ip==='192.168.1.33')?.online).toBe(false);
 expect(w.forget('10:20:30:40:50:21')).toBe(true);expect(scan([dev(33,'10-20-30-40-50-21')]).fresh).toHaveLength(1);
 // Another network is learned separately.
 const other=w.record(parseScan(raw([dev(7)],{gatewayMac:'AA-BB-CC-99-99-99',ssid:'Work'})) as Scan);expect(other.learned).toBe(1);
});
it('voice: "who\'s on my wifi" scans, then answers from the watchdog',async()=>{
 const db=openDatabase(':memory:'),now=()=>new Date(2026,9,22,12),w=new NetworkWatch(db,now);let scans=0;
 const a=new AssistantActions(new ReminderStore(db,now),db,()=>{},now,null,null,null,null,null,null,null,{network:{spoken:()=>w.spoken(),scan:async()=>{scans++;w.record(parseScan(raw([dev(1,'AA-BB-CC-00-00-01'),dev(20)])) as Scan);}}});
 expect(a.shortcut("Harmony, who's on my wifi?")).toMatch(/focus>\nnetwork/);expect(a.shortcut('any new devices on my network')).toMatch(/network/);
 const r=await a.run([{name:'status_report',arguments:{focus:'network'}}],new AbortController().signal);
 expect(scans).toBe(1);expect(r.lookup?.report).toMatch(/2 devices are on "Penn Home"/);
});
