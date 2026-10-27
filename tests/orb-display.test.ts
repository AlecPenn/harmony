import {expect,it} from 'vitest';
import {pickOrbDisplay,orbBounds,readOrbSettings,DEFAULT_ORB,type DisplayInfo} from '../core/orb-display.ts';

const area={x:0,y:0,width:1920,height:1040};
const main:DisplayInfo={id:1,label:'Generic PnP Monitor',primary:true,workArea:area};
const dell:DisplayInfo={id:2,label:'DELL P2419H',primary:false,workArea:{x:1920,y:0,width:1920,height:1040}};
const tv:DisplayInfo={id:3,label:'LG TV',primary:false,workArea:{x:-1920,y:0,width:1920,height:1080}};

it('finds the Dell by name, else any second screen; one screen means no orb',()=>{
 expect(pickOrbDisplay([main,tv,dell],DEFAULT_ORB)?.id).toBe(2);
 expect(pickOrbDisplay([main,tv],DEFAULT_ORB)?.id).toBe(3);
 expect(pickOrbDisplay([main],DEFAULT_ORB)).toBeNull();
 expect(pickOrbDisplay([{...dell,primary:true}],DEFAULT_ORB)).toBeNull(); // the Dell is the only (main) screen: the chamber is already there
 expect(pickOrbDisplay([main,dell],{...DEFAULT_ORB,on:false})).toBeNull();
});
it('a chosen screen wins while it is connected, then it falls back',()=>{
 expect(pickOrbDisplay([main,tv,dell],{...DEFAULT_ORB,display:3})?.id).toBe(3);
 expect(pickOrbDisplay([main,dell],{...DEFAULT_ORB,display:3})?.id).toBe(2);
 expect(pickOrbDisplay([main,dell],{...DEFAULT_ORB,display:1})?.id).toBe(1); // you can put it on the main screen on purpose
});
it('sits in the chosen corner of the work area (not under the taskbar), shrinking on small screens',()=>{
 expect(orbBounds(dell.workArea,'bottom-right')).toEqual({x:1920+1920-190-18,y:1040-190-18,width:190,height:190});
 expect(orbBounds(tv.workArea,'top-left')).toEqual({x:-1920+18,y:18,width:190,height:190});
 expect(orbBounds({x:0,y:0,width:200,height:200},'bottom-left').width).toBe(164);
});
it('reads settings defensively',()=>{
 expect(readOrbSettings(null)).toEqual(DEFAULT_ORB);
 expect(readOrbSettings('{bad')).toEqual(DEFAULT_ORB);
 expect(readOrbSettings({on:false,display:2,corner:'top-right'})).toEqual({on:false,display:2,corner:'top-right',drift:true});
 expect(readOrbSettings({display:'2',corner:'middle'})).toEqual(DEFAULT_ORB);
});
