/** Wi-Fi reconnect (Alec, October 26): when the PC's Wi-Fi drops and doesn't come back on its own, HARMONY reconnects it
 * to the network it was on. She reads the adapter's state with Windows' own `netsh wlan show interfaces` (read-only, no
 * admin rights) every few seconds, remembers the saved network ("profile") while connected, and if the adapter sits
 * "disconnected" past a short grace period (Windows gets the first try), runs `netsh wlan connect` for that same saved
 * network. Retries back off and never stop for good, so a long outage is still picked up. She only ever reconnects to a
 * network this PC was already connected to; she never joins anything new, never changes settings, and can't turn a
 * switched-off adapter back on (that needs admin rights). Pure logic here; the commands run in the Electron main file. */

export interface WlanInterface {name:string;state:string;ssid:string|null;profile:string|null;}
export type WlanReading=
 |{kind:'interfaces';interfaces:WlanInterface[]}
 |{kind:'no-adapter'}      // no wireless interface: switched off, unplugged or disabled
 |{kind:'service-off'}     // Windows' WLAN service isn't running
 |{kind:'unknown'};

/** A name netsh can take safely inside quotes: no quotes, no control characters, at most 64 characters. */
export const safeName=(v:string|null|undefined):v is string=>typeof v==='string'&&/^[^"\u0000-\u001f\u007f]{1,64}$/.test(v)&&v.trim()===v;

/** Reads `netsh wlan show interfaces` (English Windows). */
export function parseInterfaces(text:string):WlanReading{
 const t=String(text??'').replace(/\r/g,'');
 if(/there is no wireless interface/i.test(t))return {kind:'no-adapter'};
 if(/wlansvc|auto ?config service.*not running/i.test(t))return {kind:'service-off'};
 const list:WlanInterface[]=[];let cur:Record<string,string>|null=null;
 const flush=()=>{if(cur&&cur.name)list.push({name:cur.name,state:(cur.state??'').toLowerCase(),ssid:cur.ssid||null,profile:cur.profile||null});cur=null;};
 for(const line of t.split('\n')){
  const m=line.match(/^\s*([A-Za-z][A-Za-z ]*?)\s*:\s?(.*)$/);if(!m)continue;
  const key=m[1].trim().toLowerCase(),value=m[2].trim();
  if(key==='name'){flush();cur={name:value};continue;}
  if(!cur)continue;
  if(key==='state'||key==='ssid'||key==='profile')cur[key]=value;
 }
 flush();
 return list.length?{kind:'interfaces',interfaces:list}:{kind:'unknown'};
}

export interface ReconnectEvent {at:string;kind:'dropped'|'reconnecting'|'reconnected'|'still-down'|'no-adapter';text:string;}
export interface ReconnectView {on:boolean;profile:string|null;state:'connected'|'down'|'no-adapter'|'unknown';last:ReconnectEvent|null;attempts:number;}
export type ReconnectAction={connect:{profile:string;iface:string}}|null;

/** The wait before each try: the first 20 s after the drop is seen (Windows usually reconnects by itself within
 * seconds), then growing gaps (about 6 minutes for the first five tries), then every 10 minutes. */
export const RETRY_MS=[20000,30000,45000,90000,180000];
export const SLOW_RETRY_MS=10*60000;

export class WifiReconnect {
 #profile:string|null;#iface:string|null=null;#downSince:number|null=null;#attempts=0;#nextAt=0;#last:ReconnectEvent|null=null;
 #state:ReconnectView['state']='unknown';#told=false;#missing=false;
 constructor(profile:string|null,private remember:(profile:string)=>void=()=>{},private now:()=>number=Date.now){this.#profile=safeName(profile)?profile:null;}
 view(on:boolean):ReconnectView{return {on,profile:this.#profile,state:this.#state,last:this.#last,attempts:this.#attempts};}
 #event(kind:ReconnectEvent['kind'],text:string):ReconnectEvent{this.#last={at:new Date(this.now()).toISOString(),kind,text};return this.#last;}
 /** One reading. Returns what to do (a reconnect, or nothing) and an event worth telling Alec about, if any. */
 tick(reading:WlanReading,on:boolean):{action:ReconnectAction;tell:ReconnectEvent|null}{
  const now=this.now();
  if(reading.kind==='no-adapter'||reading.kind==='service-off'){
   this.#state='no-adapter';
   if(!this.#missing){this.#missing=true;return {action:null,tell:this.#event('no-adapter',reading.kind==='service-off'
    ?'Windows\' Wi-Fi service has stopped, so I can\'t reconnect. Restarting the PC usually brings it back.'
    :'The Wi-Fi adapter has disappeared (switched off, disabled or unplugged). I can\'t turn it back on without admin rights; check airplane mode or Network Connections.')};}
   return {action:null,tell:null};
  }
  this.#missing=false;
  if(reading.kind!=='interfaces'){this.#state='unknown';return {action:null,tell:null};}
  const connected=reading.interfaces.find(i=>i.state==='connected');
  if(connected){
   const was=this.#downSince,tries=this.#attempts;
   this.#state='connected';this.#downSince=null;this.#attempts=0;this.#nextAt=0;this.#told=false;
   const p=connected.profile??connected.ssid;
   if(safeName(p)&&p!==this.#profile){this.#profile=p;try{this.remember(p);}catch{}}
   if(safeName(connected.name))this.#iface=connected.name;
   if(was!==null&&tries>0){
    const mins=Math.max(1,Math.round((now-was)/60000));
    return {action:null,tell:this.#event('reconnected',`Wi-Fi dropped${mins>1?` for about ${mins} minutes`:''}, and I reconnected it to "${p??this.#profile}".`)};
   }
   return {action:null,tell:null};
  }
  // Only a plain "disconnected" adapter is ours to fix; connecting/authenticating means Windows is already on it.
  const down=reading.interfaces.find(i=>i.state==='disconnected');
  if(!down){this.#state='unknown';return {action:null,tell:null};}
  this.#state='down';
  if(this.#downSince===null){this.#downSince=now;this.#nextAt=now+RETRY_MS[0];this.#event('dropped','Wi-Fi disconnected.');}
  if(!on||!this.#profile||now<this.#nextAt)return {action:null,tell:null};
  const iface=safeName(down.name)?down.name:this.#iface;if(!iface)return {action:null,tell:null};
  this.#attempts++;
  this.#nextAt=now+(RETRY_MS[this.#attempts]??SLOW_RETRY_MS);
  let tell:ReconnectEvent|null=null;
  if(this.#attempts===RETRY_MS.length&&!this.#told){
   this.#told=true;
   tell=this.#event('still-down',`Wi-Fi is still down and "${this.#profile}" isn't answering. I'll keep trying every 10 minutes. If the router is off, that's the thing to check.`);
  }else this.#event('reconnecting',`Reconnecting to "${this.#profile}" (try ${this.#attempts}).`);
  return {action:{connect:{profile:this.#profile,iface}},tell};
 }
}

/** The arguments for `netsh wlan connect` (both names checked by safeName, quoted for netsh). */
export function connectArgs(a:{profile:string;iface:string}):string[]|null{
 if(!safeName(a.profile)||!safeName(a.iface))return null;
 return ['wlan','connect',`name="${a.profile}"`,`interface="${a.iface}"`];
}
