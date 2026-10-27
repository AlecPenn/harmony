import {expect,test} from 'vitest';
import {parseInterfaces,WifiReconnect,connectArgs,safeName,RETRY_MS,SLOW_RETRY_MS,type WlanReading} from '../core/wifi-reconnect.ts';

const connected=`
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wireless-AC 9560
    GUID                   : 1234
    Physical address       : aa:bb:cc:dd:ee:ff
    Interface type         : Primary
    State                  : connected
    SSID                   : Penn Home
    BSSID                  : 11:22:33:44:55:66
    Network type           : Infrastructure
    Profile                : Penn Home

    Hosted network status  : Not available
`.replace(/\n/g,'\r\n');
const disconnected=`
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wireless-AC 9560
    State                  : disconnected
    Radio status           : Hardware On
                             Software On

    Hosted network status  : Not available
`;

test('reads netsh wlan show interfaces',()=>{
 expect(parseInterfaces(connected)).toEqual({kind:'interfaces',interfaces:[{name:'Wi-Fi',state:'connected',ssid:'Penn Home',profile:'Penn Home'}]});
 expect(parseInterfaces(disconnected)).toEqual({kind:'interfaces',interfaces:[{name:'Wi-Fi',state:'disconnected',ssid:null,profile:null}]});
 expect(parseInterfaces('There is no wireless interface on the system.')).toEqual({kind:'no-adapter'});
 expect(parseInterfaces('The Wireless AutoConfig Service (wlansvc) is not running.')).toEqual({kind:'service-off'});
 expect(parseInterfaces('')).toEqual({kind:'unknown'});
});

test('only safe names reach netsh, quoted',()=>{
 expect(connectArgs({profile:'Penn Home',iface:'Wi-Fi'})).toEqual(['wlan','connect','name="Penn Home"','interface="Wi-Fi"']);
 for(const bad of ['a" & del','x\ny','',' padded','z'.repeat(65)])expect(safeName(bad)).toBe(false);
 expect(connectArgs({profile:'bad"name',iface:'Wi-Fi'})).toBeNull();
});

test('remembers the network, waits for Windows, then reconnects with backing-off retries and says so',()=>{
 let now=0;const saved:string[]=[];const w=new WifiReconnect(null,p=>saved.push(p),()=>now);
 const up=parseInterfaces(connected),down=parseInterfaces(disconnected) as WlanReading;
 expect(w.tick(up,true)).toEqual({action:null,tell:null});expect(saved).toEqual(['Penn Home']);
 now=1000;expect(w.tick(down,true).action).toBeNull();                 // just dropped: Windows gets the first try
 now=1000+RETRY_MS[0]-1;expect(w.tick(down,true).action).toBeNull();
 now=1000+RETRY_MS[0];expect(w.tick(down,true).action).toEqual({connect:{profile:'Penn Home',iface:'Wi-Fi'}});
 expect(w.tick(down,true).action).toBeNull();                           // not again straight away
 now+=RETRY_MS[1];expect(w.tick(down,true).action).not.toBeNull();
 now+=60000;const back=w.tick(up,true);
 expect(back.tell?.kind).toBe('reconnected');expect(back.tell?.text).toContain('Penn Home');
 expect(w.view(true)).toMatchObject({state:'connected',attempts:0,profile:'Penn Home'});
});

test('keeps trying slowly after five tries, telling Alec once',()=>{
 let now=0;const w=new WifiReconnect('Penn Home',()=>{},()=>now);const down=parseInterfaces(disconnected);
 w.tick(down,true);const tells:string[]=[];let tries=0;
 for(let i=0;i<200;i++){now+=5000;const r=w.tick(down,true);if(r.action)tries++;if(r.tell)tells.push(r.tell.kind);}
 // 1000 s: five quick tries (~6 min), then one every 10 minutes
 expect(tries).toBeGreaterThanOrEqual(6);expect(tries).toBeLessThanOrEqual(7);expect(tells).toEqual(['still-down']);
 now+=SLOW_RETRY_MS;expect(w.tick(down,true).action).not.toBeNull();
});

test('does nothing when switched off, with no remembered network, or while Windows is connecting',()=>{
 let now=0;const off=new WifiReconnect('Penn Home',()=>{},()=>now);const down=parseInterfaces(disconnected);
 off.tick(down,false);now=600000;expect(off.tick(down,false).action).toBeNull();
 const fresh=new WifiReconnect(null,()=>{},()=>now);fresh.tick(down,true);now+=600000;expect(fresh.tick(down,true).action).toBeNull();
 const busy=new WifiReconnect('Penn Home',()=>{},()=>now);const connecting:WlanReading={kind:'interfaces',interfaces:[{name:'Wi-Fi',state:'authenticating',ssid:null,profile:null}]};
 busy.tick(connecting,true);now+=600000;expect(busy.tick(connecting,true).action).toBeNull();
});

test('a missing adapter is reported once, honestly',()=>{
 const w=new WifiReconnect('Penn Home');const gone=parseInterfaces('There is no wireless interface on the system.');
 const first=w.tick(gone,true);expect(first.tell?.kind).toBe('no-adapter');expect(first.tell?.text).toMatch(/admin rights/);
 expect(w.tick(gone,true).tell).toBeNull();expect(w.view(true).state).toBe('no-adapter');
});
