import type {DatabaseSync} from 'node:sqlite';

/** Step 25: wave to control her. Hand signs through the PC's camera, read on this PC by the guard worker:
 *
 *  - an open palm held up while she's talking stops her (like saying "stop"),
 *  - a thumbs up or thumbs down answers an approval on the screen, but only when the camera also sees it's you,
 *  - a wave wakes her when she's waiting for "Harmony" (hands-free).
 *
 * The camera is only open while a sign could mean something (she's talking, an approval is waiting, or, if Alec turns
 * it on, she's waiting to be woken), so the camera light says when she's watching. Frames are looked at once and
 * thrown away: only the 21 joint positions of a hand come back from the worker. Phone approvals and unlocking never
 * take a hand sign. */

export type Pose='palm'|'fist'|'thumbs-up'|'thumbs-down'|'point'|'other';
export type Sign='stop'|'wave'|'yes'|'no';
export interface GestureSettings {pause:boolean;approve:boolean;wave:boolean;}
export interface GestureView {settings:GestureSettings;available:boolean;watching:boolean;why:string|null;last:{sign:Sign;at:string;result:string}|null;}
export const DEFAULT_GESTURES:GestureSettings={pause:true,approve:true,wave:false};
type P=[number,number];

const dist=(a:P,b:P)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
/** What one hand is doing. Joints are MediaPipe's 21 (0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16;
 * pinky 17-20) as fractions of the frame; `aspect` (width / height) makes distances square. */
export function pose(joints:readonly P[],aspect=1):Pose{
 if(joints.length!==21)return 'other';
 const j=joints.map(([x,y])=>[x*aspect,y] as P),wrist=j[0],size=dist(wrist,j[9]);
 if(!(size>.03))return 'other'; // too small or too far to read
 // A finger is straight when its tip is well past its middle joint, measured from the wrist.
 const straight=[[8,6],[12,10],[16,14],[20,18]].map(([tip,pip])=>dist(j[tip],wrist)>dist(j[pip],wrist)*1.18&&dist(j[tip],wrist)>size*1.15);
 const curled=[[8,6],[12,10],[16,14],[20,18]].map(([tip,pip])=>dist(j[tip],wrist)<dist(j[pip],wrist)*1.05);
 const fingers=straight.filter(Boolean).length,folded=curled.filter(Boolean).length;
 // Thumb: out from the hand, and which way it points (screen y grows downward).
 const thumbOut=dist(j[4],j[5])>size*.55&&dist(j[4],j[9])>size*.7;
 const tx=j[4][0]-j[2][0],ty=j[4][1]-j[2][1],tl=Math.hypot(tx,ty)||1;
 if(folded>=3&&thumbOut&&Math.abs(ty)/tl>.75){
  // The thumb tip must also clear the curled fingers, so a fist held sideways doesn't count.
  const knuckles=Math.min(j[5][1],j[9][1],j[13][1],j[17][1]),bottom=Math.max(j[5][1],j[9][1],j[13][1],j[17][1]);
  if(ty<0&&j[4][1]<knuckles-size*.25)return 'thumbs-up';
  if(ty>0&&j[4][1]>bottom+size*.25)return 'thumbs-down';
 }
 // Open palm: all four fingers straight and pointing up-ish.
 if(fingers===4&&j[12][1]<wrist[1]-size*.8)return 'palm';
 if(folded===4&&!thumbOut)return 'fist';
 if(straight[0]&&curled[1]&&curled[2]&&curled[3])return 'point';
 return 'other';
}

interface Frame {at:number;pose:Pose;x:number;y:number;}
/** Turns a stream of frames (a few a second) into signs: a pose has to hold for most of about a second, and a wave
 * is an open palm moving side to side and back at least twice. One sign per couple of seconds. */
export class GestureTracker {
 #frames:Frame[]=[];#quietUntil=0;private holdMs:number;private cooldownMs:number;
 constructor(holdMs=900,cooldownMs=2500){this.holdMs=holdMs;this.cooldownMs=cooldownMs;}
 reset(){this.#frames=[];}
 /** One frame's best hand (or none). Returns a sign when one is complete. */
 push(at:number,hand:{joints:readonly P[]}|null,aspect=1):Sign|null{
  const p=hand?pose(hand.joints,aspect):'other';
  this.#frames.push({at,pose:p,x:hand?hand.joints[0][0]*aspect:NaN,y:hand?hand.joints[0][1]:NaN});
  this.#frames=this.#frames.filter(f=>at-f.at<=2600);
  if(at<this.#quietUntil)return null;
  const sign=this.#wave(at)??this.#held(at);
  if(sign){this.#quietUntil=at+this.cooldownMs;this.#frames=[];}
  return sign;
 }
 #held(at:number):Sign|null{
  const recent=this.#frames.filter(f=>at-f.at<=this.holdMs+150);
  if(recent.length<3||recent.at(-1)!.at-recent[0].at<this.holdMs*.6)return null;
  for(const [p,sign] of [['palm','stop'],['thumbs-up','yes'],['thumbs-down','no']] as const){
   const hits=recent.filter(f=>f.pose===p);
   if(hits.length<Math.ceil(recent.length*.75)||recent.at(-1)!.pose!==p)continue;
   // A held sign is held still; a palm that's moving is probably a wave in progress.
   const xs=hits.map(f=>f.x);if(Math.max(...xs)-Math.min(...xs)>.07)continue;
   return sign;
  }
  return null;
 }
 #wave(at:number):Sign|null{
  const palms=this.#frames.filter(f=>f.pose==='palm'&&at-f.at<=2500&&Number.isFinite(f.x));
  if(palms.length<4)return null;
  let turns=0,dir=0,anchor=palms[0].x;
  for(const f of palms.slice(1)){
   const d=f.x-anchor;
   if(Math.abs(d)<.05)continue; // ignore jitter
   const s=Math.sign(d);
   if(dir&&s!==dir)turns++;
   dir=s;anchor=f.x;
  }
  return turns>=2?'wave':null;
 }
}

/** Whether the camera should be watching right now, and why (shown next to the camera light). */
export function watchFor(s:GestureSettings,state:{talking:boolean;approval:boolean;waiting:boolean;locked:boolean}):{watching:boolean;why:string|null}{
 if(s.approve&&state.approval)return {watching:true,why:'Thumbs up or down to answer'};
 if(state.locked)return {watching:false,why:null};
 if(s.pause&&state.talking)return {watching:true,why:'Hold up your palm to stop her'};
 if(s.wave&&state.waiting)return {watching:true,why:'Wave to wake her'};
 return {watching:false,why:null};
}

export class GestureStore {
 private db:DatabaseSync;
 constructor(db:DatabaseSync){this.db=db;}
 settings():GestureSettings{
  try{const v=JSON.parse((this.db.prepare("SELECT value FROM memory_settings WHERE key='gestures'").get() as {value?:string}|undefined)?.value??'{}');
   return {pause:typeof v.pause==='boolean'?v.pause:DEFAULT_GESTURES.pause,approve:typeof v.approve==='boolean'?v.approve:DEFAULT_GESTURES.approve,wave:typeof v.wave==='boolean'?v.wave:DEFAULT_GESTURES.wave};}
  catch{return {...DEFAULT_GESTURES};}
 }
 update(patch:unknown):GestureSettings{
  const next={...this.settings()};
  if(patch&&typeof patch==='object')for(const k of ['pause','approve','wave'] as const){const v=(patch as Record<string,unknown>)[k];if(typeof v==='boolean')next[k]=v;}
  this.db.prepare("INSERT INTO memory_settings (key,value) VALUES ('gestures',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
  return next;
 }
}
