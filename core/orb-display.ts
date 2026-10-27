/** Step 14: the mini orb. A small live HARMONY on a second screen (the Dell monitor, found by its name), in a corner,
 * showing her state; a click opens the chamber. Pure placement logic here; the window lives in the Electron main file. */
export interface Area {x:number;y:number;width:number;height:number;}
export interface DisplayInfo {id:number;label:string;primary:boolean;workArea:Area;}
export type Corner='bottom-right'|'bottom-left'|'top-right'|'top-left';
export interface OrbSettings {on:boolean;display:number|null;corner:Corner;drift:boolean;}
export const DEFAULT_ORB:OrbSettings={on:true,display:null,corner:'bottom-right',drift:true};
const CORNERS:Corner[]=['bottom-right','bottom-left','top-right','top-left'];

export function readOrbSettings(raw:unknown):OrbSettings{
 let v:Record<string,unknown>={};try{v=typeof raw==='string'?JSON.parse(raw):raw&&typeof raw==='object'?raw as Record<string,unknown>:{};}catch{}
 return {on:v.on!==false,display:Number.isSafeInteger(v.display)?v.display as number:null,corner:CORNERS.includes(v.corner as Corner)?v.corner as Corner:'bottom-right',drift:v.drift!==false};
}
/** The chosen screen if it's still connected; otherwise a Dell (preferring one that isn't the main screen); otherwise
 * any second screen. One screen and no Dell: no orb (the chamber is already there). */
export function pickOrbDisplay(list:readonly DisplayInfo[],s:OrbSettings):DisplayInfo|null{
 if(!s.on)return null;
 if(s.display!==null){const d=list.find(x=>x.id===s.display);if(d)return d;}
 const dell=(d:DisplayInfo)=>/\bdell\b/i.test(d.label);
 return list.find(d=>dell(d)&&!d.primary)??list.find(d=>!d.primary)??null;
}
export function orbBounds(area:Area,corner:Corner,size=190,margin=18):Area{
 const s=Math.max(120,Math.min(size,area.width-2*margin,area.height-2*margin));
 const right=corner.endsWith('right'),bottom=corner.startsWith('bottom');
 return {x:Math.round(right?area.x+area.width-s-margin:area.x+margin),y:Math.round(bottom?area.y+area.height-s-margin:area.y+margin),width:s,height:s};
}
