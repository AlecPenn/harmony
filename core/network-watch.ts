import type {DatabaseSync} from 'node:sqlite';

/** Step 26: the Wi-Fi watchdog. Every few minutes HARMONY looks at which devices this PC can see on the home network
 * (a fixed, read-only PowerShell script: workers/network/neighbors.ps1). The first time on a network she quietly learns
 * what's there; after that, a device she's never seen gets one alert. Alec can name a device or mark it as fine in the
 * Wi-Fi panel. Everything stays on this PC; nothing is blocked or changed on the network. */

export interface ScanDevice {ip:string;mac:string;name:string|null;}
export interface Scan {ssid:string|null;gateway:string;gatewayMac:string|null;me:string|null;devices:ScanDevice[];}
export interface KnownDevice {mac:string;ip:string;name:string|null;label:string|null;first:string;last:string;status:'baseline'|'new'|'known';}
interface Network {id:string;ssid:string|null;learnedAt:string;devices:Record<string,KnownDevice>;}
export interface NetworkView {network:{ssid:string|null;learnedAt:string}|null;devices:(KnownDevice&{online:boolean;private:boolean})[];lastScan:string|null;error:string|null;}

const MAC=/^([0-9a-f]{2}[-:]){5}[0-9a-f]{2}$/i,IP=/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ONLINE_MS=15*60000,MAX_DEVICES=400;
export const normalMac=(m:string)=>m.toLowerCase().replace(/-/g,':');
/** Phones and tablets use a made-up ("private") address per network; the second hex digit gives it away. */
export const privateMac=(m:string)=>/^.[26ae]/i.test(normalMac(m));
/** Multicast and broadcast entries aren't devices. */
const notDevice=(m:string)=>{const x=normalMac(m);return x==='ff:ff:ff:ff:ff:ff'||x==='00:00:00:00:00:00'||x.startsWith('01:00:5e')||x.startsWith('33:33')||(parseInt(x.slice(0,2),16)&1)===1;};
const text=(v:unknown,n:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n)||null:null;

/** Validates the script's output. */
export function parseScan(raw:string):Scan|{error:string}{
 let v:Record<string,unknown>;try{v=JSON.parse(raw.trim().replace(/^﻿/,''));}catch{return {error:'The network scan gave no answer.'};}
 if(!v||typeof v!=='object')return {error:'The network scan gave no answer.'};
 if(v.ok!==true)return {error:v.reason==='no network'?'This PC isn\'t on a network.':'The network scan didn\'t work.'};
 if(typeof v.gateway!=='string'||!IP.test(v.gateway))return {error:'The network scan didn\'t find a router.'};
 const list=Array.isArray(v.devices)?v.devices:v.devices&&typeof v.devices==='object'?[v.devices]:[];
 const seen=new Set<string>(),devices:ScanDevice[]=[];
 for(const d of list.slice(0,1000)){
  const r=(d??{}) as Record<string,unknown>;
  if(typeof r.ip!=='string'||!IP.test(r.ip)||typeof r.mac!=='string'||!MAC.test(r.mac)||notDevice(r.mac))continue;
  const mac=normalMac(r.mac);if(seen.has(mac))continue;seen.add(mac);
  devices.push({ip:r.ip,mac,name:text(r.name,80)});
 }
 return {ssid:text(v.ssid,64),gateway:v.gateway,gatewayMac:typeof v.gatewayMac==='string'&&MAC.test(v.gatewayMac)?normalMac(v.gatewayMac):null,me:typeof v.me==='string'&&IP.test(v.me)?v.me:null,devices};
}

export class NetworkWatch {
 private db:DatabaseSync;private now:()=>Date;#lastScan:string|null=null;#error:string|null=null;#current:string|null=null;
 constructor(db:DatabaseSync,now:()=>Date=()=>new Date()){this.db=db;this.now=now;}
 #load():Record<string,Network>{try{const v=JSON.parse((this.db.prepare("SELECT value FROM memory_settings WHERE key='network_watch'").get() as {value?:string}|undefined)?.value??'{}');return v&&typeof v==='object'?v:{};}catch{return {};}}
 #save(all:Record<string,Network>){this.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('network_watch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(all));}
 failed(error:string){this.#error=error;this.#lastScan=this.now().toISOString();}
 /** One scan. The first on a network learns what's there (no alerts); after that, returns devices never seen before. */
 record(scan:Scan):{fresh:KnownDevice[];learned:number|null}{
  const all=this.#load(),id=scan.gatewayMac??`${scan.gateway}|${scan.ssid??''}`,at=this.now().toISOString();
  this.#current=id;this.#lastScan=at;this.#error=null;
  let net=all[id],learned:number|null=null;const fresh:KnownDevice[]=[];
  if(!net){net=all[id]={id,ssid:scan.ssid,learnedAt:at,devices:{}};learned=scan.devices.length;}
  if(scan.ssid)net.ssid=scan.ssid;
  for(const d of scan.devices){
   const k=net.devices[d.mac];
   if(k){k.ip=d.ip;k.last=at;if(d.name)k.name=d.name;continue;}
   const dev:KnownDevice={mac:d.mac,ip:d.ip,name:d.name,label:d.ip===scan.gateway?'Router':d.ip===scan.me?'This PC':null,first:at,last:at,status:learned!==null||d.ip===scan.gateway||d.ip===scan.me?'baseline':'new'};
   net.devices[d.mac]=dev;if(dev.status==='new')fresh.push(dev);
  }
  // Keep the newest few hundred: devices not seen for longest are dropped first (named ones last).
  const list=Object.values(net.devices);
  if(list.length>MAX_DEVICES){list.sort((a,b)=>Number(!!b.label)-Number(!!a.label)||b.last.localeCompare(a.last));net.devices=Object.fromEntries(list.slice(0,MAX_DEVICES).map(d=>[d.mac,d]));}
  this.#save(all);return {fresh,learned};
 }
 /** Name a device, or mark it as fine (label '' just marks it known). */
 label(mac:string,label:string|null):boolean{
  const all=this.#load(),net=this.#current?all[this.#current]:null,d=net?.devices[normalMac(mac)];if(!d)return false;
  if(label!==null){d.label=text(label,40);}d.status=d.status==='new'?'known':d.status;this.#save(all);return true;
 }
 forget(mac:string):boolean{const all=this.#load(),net=this.#current?all[this.#current]:null;if(!net?.devices[normalMac(mac)])return false;delete net.devices[normalMac(mac)];this.#save(all);return true;}
 view():NetworkView{
  const net=this.#current?this.#load()[this.#current]:null,now=this.now().getTime();
  const devices=net?Object.values(net.devices).map(d=>({...d,online:now-Date.parse(d.last)<ONLINE_MS,private:privateMac(d.mac)}))
   .sort((a,b)=>Number(b.status==='new')-Number(a.status==='new')||Number(b.online)-Number(a.online)||a.ip.localeCompare(b.ip,undefined,{numeric:true})):[];
  return {network:net?{ssid:net.ssid,learnedAt:net.learnedAt}:null,devices,lastScan:this.#lastScan,error:this.#error};
 }
 /** "Who's on my Wi-Fi?" */
 spoken():string{
  const v=this.view();if(!v.network)return v.error??'I haven\'t looked at the network yet. Give me a minute.';
  const on=v.devices.filter(d=>d.online),fresh=v.devices.filter(d=>d.status==='new');
  const named=on.filter(d=>d.label&&d.label!=='This PC'&&d.label!=='Router').map(d=>d.label!).slice(0,5);
  return `${on.length} device${on.length===1?' is':'s are'} on ${v.network.ssid?`"${v.network.ssid}"`:'your network'} right now${named.length?`, including ${named.join(', ')}`:''}.${fresh.length?` ${fresh.length} I don't know yet: ${fresh.slice(0,3).map(describe).join('; ')}. Name them or mark them as fine in the Wi-Fi panel.`:' None I don\'t know.'}`;
 }
}
export function describe(d:KnownDevice):string{
 return `${d.name?d.name.replace(/\.(lan|local|home|localdomain)$/i,''):privateMac(d.mac)?'a phone or tablet (private address)':'an unnamed device'} at ${d.ip}`;
}
export function alertText(fresh:readonly KnownDevice[],ssid:string|null):string{
 const where=ssid?`"${ssid}"`:'your network';
 return fresh.length===1?`A new device joined ${where}: ${describe(fresh[0])}. If you don't know it, check your router.`
  :`${fresh.length} new devices joined ${where}: ${fresh.slice(0,3).map(describe).join('; ')}${fresh.length>3?', and more':''}. If you don't know them, check your router.`;
}
