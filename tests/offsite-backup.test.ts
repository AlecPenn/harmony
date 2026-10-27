import {expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OffsiteBackups,recoveryText,parseRecovery,seal,open,WrongKey,FOLDER,KEEP} from '../core/offsite-backup.ts';

const cipher={available:async()=>true,encrypt:async(t:string)=>Buffer.from('sealed:'+t),decrypt:async(b:Buffer)=>b.toString().replace(/^sealed:/,'')};
const files={'harmony.sqlite':Buffer.from('SQLite format 3\0 pretend database'),'settings.json':Buffer.from('{"a":1}')};

it('the recovery key round-trips, tolerates spaces, dashes, lower case and 0 for O, and rejects typos',()=>{
 for(let i=0;i<50;i++){const k=randomBytes(32),t=recoveryText(k);expect(t).toMatch(/^([A-Z2-9]{4}-){12}[A-Z2-9]{4}$/);expect(parseRecovery(t)!.equals(k)).toBe(true);
  expect(parseRecovery(t.toLowerCase().replace(/-/g,' '))!.equals(k)).toBe(true);}
 const k=Buffer.alloc(32,0),t=recoveryText(k);expect(parseRecovery(t)!.equals(k)).toBe(true);
 expect(parseRecovery(t.slice(0,-1))).toBeNull();expect(parseRecovery(t.replace(/.$/,'1'))).toBeNull();
 expect(parseRecovery('hello')).toBeNull();
});
it('copies are AES-256-GCM: the right key opens them; a wrong key or one changed byte is refused',()=>{
 const k=randomBytes(32),data=seal(k,{at:'2026-10-22T14:00:00.000Z',files});
 expect(data.includes(Buffer.from('pretend database'))).toBe(false);
 const back=open(k,data);expect(back.at).toBe('2026-10-22T14:00:00.000Z');expect(back.files['harmony.sqlite'].equals(files['harmony.sqlite'])).toBe(true);
 expect(()=>open(randomBytes(32),data)).toThrow(WrongKey);
 const bad=Buffer.from(data);bad[60]^=1;expect(()=>open(k,bad)).toThrow(/damaged or was changed/);
 expect(()=>open(k,Buffer.from('nope'))).toThrow(/Not a HARMONY/);
});
it('needs the key saved before copying; writes to every reachable place, once a day, keeping the newest 14',async()=>{
 const root=mkdtempSync(join(tmpdir(),'offsite-')),one=join(root,'OneDrive'),usb=join(root,'E-drive'),gone=join(root,'unplugged');
 for(const d of [one,usb])mkdirSync(d);
 const clock={t:Date.parse('2026-10-22T14:00:00Z')};
 const o=new OffsiteBackups(join(root,'cred','offsite.enc'),cipher,()=>new Date(clock.t));
 const {recovery}=await o.enable([one,usb,gone]);expect(recovery).toMatch(/^([A-Z2-9]{4}-){12}[A-Z2-9]{4}$/);
 expect(await o.run(files)).toEqual({written:[],skipped:[]}); // not until the key is confirmed saved
 expect(await o.confirm('ZZZZ')).toBe(false);expect(await o.confirm(recovery!.split('-').at(-1)!.toLowerCase())).toBe(true);
 expect((await o.enable([one,usb,gone])).recovery).toBeNull(); // the key is never shown again
 const r=await o.run(files);expect(r.written).toEqual([one,usb]);expect(r.skipped).toEqual([gone]);
 expect((await o.status()).error).toMatch(/unplugged/);
 clock.t+=3600000;expect((await o.run(files)).written).toEqual([]); // already done today
 for(let i=0;i<16;i++){clock.t+=21*3600000;await o.run(files);}
 expect(readdirSync(join(one,FOLDER)).filter(n=>n.endsWith('.hbk'))).toHaveLength(KEEP);
 const st=await o.status();expect(st).toMatchObject({set:true,confirmed:true,on:true});expect(st.targets[0]).toMatchObject({reachable:true,count:KEEP});expect(st.targets[2].reachable).toBe(false);
 // Restore: with the typed recovery key (new PC) or the stored one (this PC); a wrong key is explained.
 const file=join(one,FOLDER,readdirSync(join(one,FOLDER)).filter(n=>n.endsWith('.hbk')).sort().at(-1)!);
 expect((await o.restore(file,recovery)).files['settings.json'].toString()).toBe('{"a":1}');
 expect((await o.restore(file,null)).files['harmony.sqlite'].equals(files['harmony.sqlite'])).toBe(true);
 await expect(o.restore(file,recoveryText(randomBytes(32)))).rejects.toThrow(WrongKey);
 await expect(o.restore(file,'not a key')).rejects.toThrow(/doesn't look like a recovery key/);
 await expect(o.restore(join(root,'evil.txt'),recovery)).rejects.toThrow(/\.hbk/);
 // Nothing readable is left lying around.
 expect(readFileSync(file).includes(Buffer.from('SQLite format'))).toBe(false);
 await o.disable();expect((await o.status()).on).toBe(false);expect(existsSync(join(root,'cred','offsite.enc'))).toBe(true);
});
