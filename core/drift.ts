import type {Area} from './orb-display.ts';

/** Later step (October 22): floating HARMONY moves on her own. When she's floating on the desktop, she keeps out of the
 * way of what you're doing (the cursor and the window you're using), comes nearer while you're talking to her, and steps
 * aside (hidden) for full-screen video and games. She uses only window and cursor positions, never screenshots, and
 * stays inside the screen's work area. Moving her by hand pauses this for a while. Pure placement logic; the window
 * lives in the Electron main file. */

export type DriftMode='talking'|'busy'|'idle';
export interface Point {x:number;y:number;}
export interface DriftInput {area:Area;display:Area;size:{width:number;height:number};current:Area;cursor:Point;focused:Area|null;mode:DriftMode;}

const overlap=(a:Area,b:Area)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const centre=(a:Area):Point=>({x:a.x+a.width/2,y:a.y+a.height/2});
const inside=(p:Point,a:Area,pad=0)=>p.x>=a.x-pad&&p.x<=a.x+a.width+pad&&p.y>=a.y-pad&&p.y<=a.y+a.height+pad;

/** Where she can sit: the four corners and the middle of each side edge. */
export function spots(area:Area,size:{width:number;height:number},margin=24):Area[]{
 const {width:w,height:h}=size,l=area.x+margin,r=area.x+area.width-w-margin,t=area.y+margin,b=area.y+area.height-h-margin,m=Math.round(area.y+(area.height-h)/2);
 return [[r,b],[l,b],[r,t],[l,t],[r,m],[l,m]].map(([x,y])=>({x:Math.round(x),y:Math.round(y),width:w,height:h}));
}
/** A window covering the whole screen (video, a game, a presentation). */
export const fullScreen=(focused:Area|null,display:Area)=>!!focused&&overlap(focused,display)>=display.width*display.height*.97;

/** How good a spot is (lower is better). */
export function cost(spot:Area,i:DriftInput):number{
 const diag=Math.hypot(i.area.width,i.area.height)||1,c=centre(spot),d=Math.hypot(c.x-i.cursor.x,c.y-i.cursor.y)/diag;
 let s=0;
 if(i.focused)s+=overlap(spot,i.focused)/(spot.width*spot.height)*(i.mode==='busy'?12:i.mode==='talking'?3:6);
 if(inside(i.cursor,spot,60))s+=20; // never sit under the pointer
 s+=i.mode==='talking'?d*4:i.mode==='busy'?-d*3:-d*.5;
 return s;
}
/** The spot to move to, the current one to stay put (null move), or 'hide' for full screen. Only moves when the best
 * spot is clearly better than where she is, so she doesn't fidget. */
export function chooseSpot(i:DriftInput):Area|'hide'|null{
 if(fullScreen(i.focused,i.display))return 'hide';
 const options=spots(i.area,i.size);
 const here=cost(i.current,i),best=options.map(s=>({s,c:cost(s,i)})).sort((a,b)=>a.c-b.c)[0];
 if(!best)return null;
 const near=Math.abs(best.s.x-i.current.x)<8&&Math.abs(best.s.y-i.current.y)<8;
 return near||best.c>here-1?null:best.s;
}
/** Eased steps from one place to another (about a third of a second at 60 fps). */
export function glide(from:Point,to:Point,steps=20):Point[]{
 return Array.from({length:steps},(_,k)=>{const t=(k+1)/steps,e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;return {x:Math.round(from.x+(to.x-from.x)*e),y:Math.round(from.y+(to.y-from.y)*e)};});
}

export interface Screen {id:number;area:Area;display:Area;}
const contains=(a:Area,p:Point)=>p.x>=a.x&&p.x<a.x+a.width&&p.y>=a.y&&p.y<a.y+a.height;
/** Across up to four (or more) screens: she stays on the screen she's on, follows you to your screen while you talk to
 * her, and moves to another screen (instead of hiding) when a full-screen window takes hers. */
export function planDrift(screens:readonly Screen[],i:Omit<DriftInput,'area'|'display'>):Area|'hide'|null{
 if(!screens.length)return null;
 const mid=centre(i.current),here=screens.find(s=>contains(s.display,mid))??screens.reduce((a,b)=>Math.hypot(centre(a.display).x-mid.x,centre(a.display).y-mid.y)<=Math.hypot(centre(b.display).x-mid.x,centre(b.display).y-mid.y)?a:b);
 const pointer=screens.find(s=>contains(s.display,i.cursor))??here;
 const blocked=(s:Screen)=>!!i.focused&&fullScreen(i.focused,s.display);
 let target=here;
 if(i.mode==='talking'&&pointer.id!==here.id&&!blocked(pointer))target=pointer;
 if(blocked(target)){const other=screens.find(s=>s.id!==target.id&&!blocked(s));if(!other)return 'hide';target=other;}
 const input:DriftInput={...i,area:target.area,display:target.display};
 if(target.id===here.id)return chooseSpot(input);
 // A new screen: the best spot there, whatever it costs here.
 return spots(target.area,i.size).map(sp=>({sp,c:cost(sp,input)})).sort((a,b)=>a.c-b.c)[0]?.sp??null;
}
