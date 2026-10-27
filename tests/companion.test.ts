import {test,expect,afterEach} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {CompanionAuth,CompanionServer,isLocalAddress,MAX_DEVICES} from '../core/companion.ts';

const dbs:ReturnType<typeof openDatabase>[]=[];const servers:CompanionServer[]=[];
afterEach(async()=>{for(const s of servers.splice(0))await s.stop();for(const db of dbs.splice(0))db.close();});

test('only loopback and private network addresses are local',()=>{
 for(const a of ['127.0.0.1','::1','::ffff:192.168.1.20','10.0.0.5','172.20.1.1','fe80::1','fd12::3'])expect(isLocalAddress(a),a).toBe(true);
 for(const a of ['8.8.8.8','172.32.0.1','::ffff:203.0.113.9','2001:db8::1',undefined])expect(isLocalAddress(a),String(a)).toBe(false);
});

test('pairing: one code, ten minutes, five tries, used once; tokens stored only as hashes; devices can be forgotten',()=>{
 const db=openDatabase(':memory:');dbs.push(db);let now=0;const auth=new CompanionAuth(db,()=>now);
 expect(auth.pair('123456','x')).toBeNull();
 const code=auth.newCode();expect(code).toMatch(/^\d{6}$/);
 const wrong=code==='000000'?'111111':'000000';
 expect(auth.pair(wrong,'x')).toBeNull();const token=auth.pair(code,'iPhone <script>')!;expect(token).toMatch(/^[0-9a-f]{64}$/);
 expect(auth.pair(code,'again')).toBeNull();
 const stored=JSON.stringify(auth.devices());expect(stored).not.toContain(token);expect(auth.devices()[0].name).toBe('iPhone script');
 expect(auth.check(`Bearer ${token}`)?.name).toBe('iPhone script');expect(auth.check('Bearer '+'0'.repeat(64))).toBeNull();expect(auth.check(token)).toBeNull();
 const c2=auth.newCode();for(let i=0;i<5;i++)auth.pair(c2==='999999'?'888888':'999999','x');expect(auth.pair(c2,'x')).toBeNull();
 const c3=auth.newCode();now+=11*60000;expect(auth.pair(c3,'x')).toBeNull();
 expect(auth.forget(auth.devices()[0].id)).toBe(true);expect(auth.check(`Bearer ${token}`)).toBeNull();
 for(let i=0;i<MAX_DEVICES+2;i++){const c=auth.newCode();auth.pair(c,`p${i}`);}expect(auth.devices()).toHaveLength(MAX_DEVICES);
});

test('the server: off by default, page and pairing open, everything else needs the token, origin checked, STOP and ask work',async()=>{
 const db=openDatabase(':memory:');dbs.push(db);const auth=new CompanionAuth(db);const asked:string[]=[];let stopped=0;
 const port=47900+Math.floor(Math.random()*500);
 const server=new CompanionServer(db,auth,{state:()=>({local:{state:'IDLE',text:'hi'}}),ask:t=>{if(t==='busy')throw new Error('HARMONY is busy right now.');asked.push(t);},stop:async()=>{stopped++;},changed:()=>{}},port);servers.push(server);
 server.start();expect(server.status().enabled).toBe(false);
 server.setEnabled(true);await new Promise(r=>setTimeout(r,100));
 const base=`http://127.0.0.1:${port}`;
 const page=await fetch(base+'/');expect(page.status).toBe(200);expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");expect(await page.text()).toContain('PAIR THIS PHONE');
 expect((await fetch(base+'/api/state')).status).toBe(401);
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 expect((await post('/api/pair',{code:'000000'})).status).toBe(401);
 const code=auth.newCode();const {token}=await (await post('/api/pair',{code,name:'Android phone'})).json();
 const auth_={Authorization:`Bearer ${token}`};
 expect(await (await fetch(base+'/api/state',{headers:auth_})).json()).toEqual({local:{state:'IDLE',text:'hi'}});
 expect((await post('/api/ask',{text:'Idea: a glow-in-the-dark album cover'},auth_)).status).toBe(202);expect(asked).toEqual(['Idea: a glow-in-the-dark album cover']);
 expect((await post('/api/ask',{text:'busy'},auth_)).status).toBe(409);expect((await post('/api/ask',{text:''},auth_)).status).toBe(400);
 expect((await post('/api/ask',{text:'x'},{...auth_,Origin:'http://evil.example'})).status).toBe(403);
 expect((await fetch(base+'/api/ask',{method:'POST',headers:{...auth_,'Content-Type':'text/plain'},body:'hi'})).status).toBe(415);
 expect((await post('/api/ask',{text:'x'.repeat(9000)},auth_)).status).toBe(413);
 expect((await post('/api/stop',{},auth_)).status).toBe(200);expect(stopped).toBe(1);
 server.setEnabled(false);await new Promise(r=>setTimeout(r,100));
 await expect(fetch(base+'/')).rejects.toThrow();
});

test('the page signs with its own SHA-256/HMAC, matching node:crypto, and the page script parses',async()=>{
 const {PAGE_CRYPTO,COMPANION_PAGE}=await import('../core/companion-page.ts');
 const {createHash,createHmac}=await import('node:crypto');
 const f=new Function(`${PAGE_CRYPTO};return {sha256,hmac,hex,utf8};`)() as {sha256(b:Uint8Array):Uint8Array;hmac(k:string,m:string):string;hex(b:Uint8Array):string;utf8(s:string):Uint8Array};
 for(const m of ['','abc','x'.repeat(55),'x'.repeat(56),'x'.repeat(64),'héllo ✨'.repeat(40)])expect(f.hex(f.sha256(f.utf8(m)))).toBe(createHash('sha256').update(m).digest('hex'));
 for(const k of ['k','a'.repeat(64),'b'.repeat(100)])expect(f.hmac(k,'POST\n/api/approve\n1\n2\nabc')).toBe(createHmac('sha256',k).update('POST\n/api/approve\n1\n2\nabc').digest('hex'));
 const script=COMPANION_PAGE.slice(COMPANION_PAGE.indexOf('<script>')+8,COMPANION_PAGE.lastIndexOf('</script>'));
 expect(()=>new Function(script)).not.toThrow();
});

test('approvals need a signed request: no replay, no stale time, no bare token',async()=>{
 const {signingText}=await import('../core/companion.ts');const {createHmac,randomBytes}=await import('node:crypto');
 const db=openDatabase(':memory:');dbs.push(db);
 const seal={seal:(t:string)=>'S'+Buffer.from(t).toString('base64'),open:(s:string)=>Buffer.from(s.slice(1),'base64').toString()};
 const auth=new CompanionAuth(db,Date.now,seal);const answers:unknown[]=[];let locked=0;
 const guard={pending:()=>[{id:'0123456789abcdef',title:'Open Spotify',choices:[12,47,80]}],answer:(id:string,a:unknown)=>{answers.push([id,a]);return 'ok';},lock:()=>{locked++;},unlock:()=>{locked--;}};
 const port=48500+Math.floor(Math.random()*400);
 const server=new CompanionServer(db,auth,{state:()=>({}),ask:()=>{},stop:async()=>{},changed:()=>{},guard},port);servers.push(server);
 server.setEnabled(true);await new Promise(r=>setTimeout(r,100));
 const base=`http://127.0.0.1:${port}`;
 const code=auth.newCode();const paired=await (await fetch(base+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,name:'Pixel'})})).json();
 expect(paired.device).toMatch(/^[0-9a-f]{16}$/);expect(JSON.stringify(auth.devices())).not.toContain(paired.token);
 const signed=(method:string,path:string,body:string,time=Date.now(),nonce=randomBytes(16).toString('hex'))=>({'Content-Type':'application/json','X-Harmony-Device':paired.device,'X-Harmony-Time':String(time),'X-Harmony-Nonce':nonce,
  'X-Harmony-Sig':createHmac('sha256',paired.token).update(signingText(method,path,String(time),nonce,body)).digest('hex')});
 expect((await (await fetch(base+'/api/approvals',{headers:signed('GET','/api/approvals','')})).json()).approvals[0].title).toBe('Open Spotify');
 expect((await (await fetch(base+'/api/approvals',{headers:{Authorization:`Bearer ${paired.token}`}})).json()).approvals).toEqual([]);
 const body=JSON.stringify({id:'0123456789abcdef',approve:true,pick:47,trust:false});
 const h=signed('POST','/api/approve',body);
 expect((await fetch(base+'/api/approve',{method:'POST',headers:h,body})).status).toBe(200);
 expect((await fetch(base+'/api/approve',{method:'POST',headers:h,body})).status).toBe(401);           // replayed nonce
 expect((await fetch(base+'/api/approve',{method:'POST',headers:signed('POST','/api/approve',body,Date.now()-120000),body})).status).toBe(401); // stale
 const tampered=JSON.stringify({id:'0123456789abcdef',approve:true,pick:12,trust:false});
 expect((await fetch(base+'/api/approve',{method:'POST',headers:signed('POST','/api/approve',body),body:tampered})).status).toBe(401); // body changed
 expect((await fetch(base+'/api/approve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${paired.token}`},body})).status).toBe(403);
 expect(answers).toEqual([['0123456789abcdef',{approve:true,pick:47,trust:false}]]);
 expect((await fetch(base+'/api/lock',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${paired.token}`},body:'{}'})).status).toBe(200);expect(locked).toBe(1);
});
