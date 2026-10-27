import {expect,it} from 'vitest';
import {openDatabase} from '../core/storage.ts';
import {pose,GestureTracker,watchFor,GestureStore,DEFAULT_GESTURES} from '../core/gestures.ts';
import {Guardian,type Seal,type GuardDeps} from '../core/guardian.ts';

type P=[number,number];
/** A synthetic hand (fractions of a square frame), built from simple offsets around the wrist. */
function hand(kind:'palm'|'fist'|'thumbs-up'|'thumbs-down'|'point',at:P=[.5,.75],s=1):P[]{
 const w=at,j:P[]=new Array(21);const put=(i:number,dx:number,dy:number)=>{j[i]=[w[0]+dx*s,w[1]+dy*s];};
 put(0,0,0);
 if(kind==='thumbs-up'||kind==='thumbs-down'){
  const f=kind==='thumbs-up'?1:-1; // a sideways fist, thumb up (or down)
  const mcp:P[]=[[.09,-.03*f],[.1,0],[.095,.025*f],[.085,.05*f]];
  mcp.forEach(([x,y],k)=>{const b=5+4*k;put(b,x,y);put(b+1,x+.03,y);put(b+2,x+.02,y+.01*f);put(b+3,x-.01,y);});
  put(1,.03,-.03*f);put(2,.05,-.05*f);put(3,.055,-.09*f);put(4,.06,-.13*f);return j;
 }
 const mcp:P[]=[[-.03,-.09],[0,-.1],[.025,-.095],[.05,-.085]];
 mcp.forEach(([x,y],k)=>{const b=5+4*k,open=kind==='palm'||(kind==='point'&&k===0);
  if(open){put(b,x,y);put(b+1,x,y-.04);put(b+2,x,y-.065);put(b+3,x,y-.085);}
  else{put(b,x,y);put(b+1,x,y-.03);put(b+2,x,y-.01);put(b+3,x,y+.02);}});
 if(kind==='palm'){put(1,-.03,-.02);put(2,-.06,-.04);put(3,-.08,-.06);put(4,-.1,-.075);}
 else{put(1,-.03,-.02);put(2,-.05,-.04);put(3,-.05,-.06);put(4,-.035,-.075);}
 return j;
}

it('reads poses from 21 joints',()=>{
 for(const k of ['palm','fist','thumbs-up','thumbs-down','point'] as const)expect(pose(hand(k)),k).toBe(k);
 expect(pose(hand('palm',[.5,.75],.2))).toBe('other'); // too far away to read
 expect(pose(hand('palm').slice(0,20))).toBe('other');
 // Distances are made square with the frame's aspect, so a 4:3 frame reads the same hand the same way.
 expect(pose(hand('palm').map(([x,y])=>[x/1.333,y] as P),1.333)).toBe('palm');
});
it('a sign has to hold for about a second; a wave is a palm moving side to side; one sign per couple of seconds',()=>{
 const t=new GestureTracker();let now=0;const feed=(k:Parameters<typeof hand>[0]|null,x=.5)=>{now+=160;return t.push(now,k?{joints:hand(k,[x,.75])}:null);};
 expect([feed('palm'),feed('palm'),feed('palm')]).toEqual([null,null,null]);
 const signs=[feed('palm'),feed('palm'),feed('palm')].filter(Boolean);expect(signs).toEqual(['stop']);
 // Cooldown: the same palm doesn't fire again straight away.
 for(let i=0;i<10;i++)expect(feed('palm')).toBeNull();
 now+=3000;t.reset();
 // A palm flicker in the middle of nothing isn't a sign.
 expect([feed(null),feed('palm'),feed(null),feed('fist'),feed(null),feed('palm'),feed(null)].filter(Boolean)).toEqual([]);
 now+=3000;t.reset();
 const waved=[.4,.5,.6,.5,.4,.5,.6].map(x=>feed('palm',x)).filter(Boolean);expect(waved).toEqual(['wave']);
 now+=3000;t.reset();
 expect(Array.from({length:8},()=>feed('thumbs-up')).filter(Boolean)).toEqual(['yes']);
 now+=3000;t.reset();
 expect(Array.from({length:8},()=>feed('thumbs-down')).filter(Boolean)).toEqual(['no']);
});
it('the camera only watches when a sign could mean something',()=>{
 const s=DEFAULT_GESTURES,base={talking:false,approval:false,waiting:false,locked:false};
 expect(watchFor(s,base).watching).toBe(false);
 expect(watchFor(s,{...base,talking:true})).toEqual({watching:true,why:'Hold up your palm to stop her'});
 expect(watchFor(s,{...base,waiting:true}).watching).toBe(false); // waving to wake is off by default
 expect(watchFor({...s,wave:true},{...base,waiting:true}).watching).toBe(true);
 expect(watchFor(s,{...base,approval:true}).why).toMatch(/Thumbs/);
 expect(watchFor({...s,approve:false},{...base,approval:true}).watching).toBe(false);
 expect(watchFor(s,{...base,talking:true,locked:true}).watching).toBe(false);
 const store=new GestureStore(openDatabase(':memory:'));expect(store.settings()).toEqual(DEFAULT_GESTURES);
 expect(store.update({wave:true,pause:'yes',evil:true})).toEqual({...DEFAULT_GESTURES,wave:true});expect(store.settings().wave).toBe(true);
});
it('a thumbs up answers the one approval on the screen, only when the camera saw your face, never phone approvals',async()=>{
 const seal:Seal={available:async()=>true,encrypt:async t=>Buffer.from('sealed:'+t),decrypt:async b=>b.toString().replace(/^sealed:/,'')};
 let phone=false;const deps:GuardDeps={phonePaired:()=>phone,alert:()=>{},changed:()=>{},models:()=>({voice:true,face:true})};
 const g=new Guardian(openDatabase(':memory:'),seal,deps,()=>1_000_000);await g.load();
 expect(g.deskApproval()).toBe(false);expect(g.gesture(true,'owner')).toBe('ignored');
 const sig=new AbortController().signal;
 const a=g.approve('test',{title:'Open example.com',detail:''},sig);expect(g.deskApproval()).toBe(true);
 expect(g.gesture(true,'stranger')).toBe('ignored');expect(g.gesture(true,'unchecked')).toBe('ignored');expect(g.deskApproval()).toBe(true);
 expect(g.gesture(true,'owner')).toBe('approved');await expect(a).resolves.toBe(true);
 const b=g.approve('test',{title:'Again',detail:''},sig);expect(g.gesture(false,'owner')).toBe('refused');await expect(b).resolves.toBe(false);
 phone=true;const c=new AbortController();const p=g.approve('test',{title:'On the phone',detail:''},c.signal);p.catch(()=>{});
 expect(g.deskApproval()).toBe(false);expect(g.gesture(true,'owner')).toBe('ignored');c.abort();
 expect(g.events().some(e=>e.kind==='gesture'&&/couldn't see it was you/.test(e.detail))).toBe(true);
});
