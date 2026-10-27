import {expect,it} from 'vitest';
import {chooseSpot,spots,cost,fullScreen,glide,type DriftInput} from '../core/drift.ts';
import {readOrbSettings} from '../core/orb-display.ts';

const area={x:0,y:0,width:1920,height:1040},display={x:0,y:0,width:1920,height:1080},size={width:330,height:390};
const [br,bl,tr,tl,mr,ml]=spots(area,size);
const input=(o:Partial<DriftInput>):DriftInput=>({area,display,size,current:br,cursor:{x:960,y:540},focused:null,mode:'idle',...o});

it('sits in a corner or the middle of a side edge, inside the work area',()=>{
 expect(br).toEqual({x:1566,y:626,width:330,height:390});expect(tl).toEqual({x:24,y:24,width:330,height:390});expect(mr.y).toBe(325);
 for(const s of spots(area,size))expect(s.x>=0&&s.y>=0&&s.x+s.width<=1920&&s.y+s.height<=1040).toBe(true);
});
it('gets out from under the pointer and out of the way of the window you\'re using, but doesn\'t fidget',()=>{
 expect(chooseSpot(input({}))).toBeNull(); // nothing in the way: stay
 const moved=chooseSpot(input({cursor:{x:1700,y:800}}));expect(moved).not.toBeNull();expect(moved).not.toBe('hide');
 expect(cost(moved as never,input({cursor:{x:1700,y:800}}))).toBeLessThan(cost(br,input({cursor:{x:1700,y:800}})));
 // Busy in a window on the right half: she goes left.
 const right={x:960,y:0,width:960,height:1040};
 expect((chooseSpot(input({focused:right,mode:'busy',cursor:{x:1400,y:300}})) as {x:number}).x).toBe(24);
 // Talking: she comes nearer the pointer (without covering it).
 const near=chooseSpot(input({current:tl,mode:'talking',cursor:{x:1700,y:900}})) as {x:number;y:number};
 expect(near.x).toBe(1566);expect(near.y).toBeLessThan(626); // the right edge, not under the pointer
});
it('steps aside for full-screen video and games',()=>{
 expect(fullScreen({x:0,y:0,width:1920,height:1080},display)).toBe(true);expect(fullScreen({x:0,y:0,width:1920,height:1040},display)).toBe(false);
 expect(chooseSpot(input({focused:display}))).toBe('hide');
});
it('glides smoothly and lands exactly; the setting defaults on',()=>{
 const g=glide({x:0,y:0},{x:100,y:-50});expect(g).toHaveLength(20);expect(g.at(-1)).toEqual({x:100,y:-50});
 for(let i=1;i<g.length;i++)expect(g[i].x).toBeGreaterThanOrEqual(g[i-1].x);
 expect(readOrbSettings(null).drift).toBe(true);expect(readOrbSettings({drift:false}).drift).toBe(false);
});

it('works on any of four screens: stays on hers, follows you while talking, moves screens for full-screen windows',async()=>{
 const {planDrift}=await import('../core/drift.ts');
 const scr=(id:number,x:number,y:number,w=1920,h=1080)=>({id,display:{x,y,width:w,height:h},area:{x,y,width:w,height:h-40}});
 const screens=[scr(1,0,0),scr(2,1920,0,2560,1440),scr(3,-1920,0),scr(4,0,-1080)];
 const onTwo=spots(screens[1].area,size)[0]; // bottom-right of screen 2
 const base={size,current:onTwo,cursor:{x:1920+2560-200,y:1440-200},focused:null,mode:'idle' as const};
 // The pointer comes to her on screen 2: she moves, and stays on screen 2.
 const m=planDrift(screens,base) as {x:number;y:number};expect(m.x).toBeGreaterThanOrEqual(1920);expect(m.x).toBeLessThan(1920+2560);
 // Talking while you're on screen 3: she comes over.
 const t=planDrift(screens,{...base,mode:'talking',cursor:{x:-900,y:500}}) as {x:number};expect(t.x).toBeLessThan(0);
 // A full-screen game on screen 2: she moves to another screen instead of hiding; with every screen full-screen she hides.
 const f=planDrift(screens,{...base,focused:screens[1].display}) as {x:number;y:number};expect(f.x<1920||f.y<0||f.x>=0&&f.x<1920).toBe(true);
 expect(planDrift([screens[1]],{...base,focused:screens[1].display})).toBe('hide');
 // On the screen above (negative coordinates) she works the same.
 const four=spots(screens[3].area,size)[0];expect(planDrift(screens,{...base,current:four,cursor:{x:four.x+100,y:four.y+100}})).not.toBeNull();
});
