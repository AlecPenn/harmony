import {BrowserWindow,screen,session,shell} from 'electron';
import {ambientScript,applyViewScript,replayScript,type GodsEye,type GevView,type ReplayStop} from '../../../core/gods-eye.ts';

/** God's Eye View in its own window. It has its own browser profile (separate from HARMONY's, which blocks the web),
 * may only show pages from GEV's local server, opens outside links in your normal browser, and gets no camera,
 * microphone or other device permissions. HARMONY drives it with GEV's own in-page actions. */
export class GodsEyeWindow {
 #win:BrowserWindow|null=null;#loading:Promise<BrowserWindow>|null=null;
 private gev:GodsEye;private changed:()=>void;
 /** HARMONY Lite mode for the globe (overlays/gods-eye/files/src/harmonyLite.js): lighter rendering for this PC's GPU. */
 lite:()=>boolean=()=>true;
 constructor(gev:GodsEye,changed:()=>void){this.gev=gev;this.changed=changed;}
 get open(){return !!this.#win&&!this.#win.isDestroyed();}
 async #ensure():Promise<BrowserWindow>{
  if(this.#win&&!this.#win.isDestroyed())return this.#win;
  if(this.#loading)return this.#loading;
  this.#loading=(async()=>{
   if(!await this.gev.ensure())throw new Error(this.gev.status().error??"God's Eye isn't running.");
   const origin=this.gev.origin,ses=session.fromPartition('persist:godseye');
   ses.setPermissionRequestHandler((_c,_p,cb)=>cb(false));
   ses.setPermissionCheckHandler(()=>false);
   const win=new BrowserWindow({width:1500,height:920,minWidth:900,minHeight:600,title:"God's Eye · HARMONY",backgroundColor:'#000000',autoHideMenuBar:true,show:false,
    webPreferences:{session:ses,contextIsolation:true,sandbox:true,nodeIntegration:false,webviewTag:false,allowRunningInsecureContent:false,webSecurity:true}});
   const local=(url:string)=>{try{return new URL(url).origin===origin;}catch{return false;}};
   win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void shell.openExternal(url);return {action:'deny'};});
   win.webContents.on('will-navigate',(e,url)=>{if(!local(url)){e.preventDefault();if(/^https:\/\//.test(url))void shell.openExternal(url);}});
   win.webContents.on('will-redirect',(e,url)=>{if(!local(url))e.preventDefault();});
   win.on('closed',()=>{if(this.#win===win){this.#win=null;this.#ambient=false;this.#ambientWatch=false;this.gev.windowOpen=false;this.changed();}});
   win.once('ready-to-show',()=>win.show());
   await win.loadURL(`${origin}/?lite=${this.lite()?1:0}`);
   this.#win=win;this.gev.windowOpen=true;this.changed();
   return win;
  })().finally(()=>{this.#loading=null;});
  return this.#loading;
 }
 /** Opens (or focuses) the window and shows a view: layers on, then the camera to the place or answer. */
 async show(request:{layers:string[];place:string;view:GevView|null}):Promise<void>{
  const win=await this.#ensure();if(win.isMinimized())win.restore();win.show();win.focus();
  const view:GevView={...(request.view??{}),layers:[...new Set([...(request.view?.layers??[]),...request.layers])]};
  const script=applyViewScript(view,request.place);
  try{await win.webContents.executeJavaScript(script,true);}catch{}
 }
 #ambient=false;
 get ambient(){return this.#ambient&&this.open;}
 /** Ambient mode: full screen on the second monitor when there is one (else this one), the globe turning slowly.
  * Off: leaves full screen and stops the turning. Esc or closing the window also ends it. */
 async setAmbient(on:boolean):Promise<boolean>{
  if(!on){const w=this.#win;this.#ambient=false;if(!w||w.isDestroyed())return true;if(w.isFullScreen())w.setFullScreen(false);try{await w.webContents.executeJavaScript(ambientScript(false),true);}catch{}this.changed();return true;}
  const win=await this.#ensure();
  const displays=screen.getAllDisplays(),primary=screen.getPrimaryDisplay(),other=displays.find(d=>d.id!==primary.id)??primary;
  if(win.isFullScreen())win.setFullScreen(false);
  win.setBounds({x:other.bounds.x+40,y:other.bounds.y+40,width:Math.min(1200,other.bounds.width-80),height:Math.min(800,other.bounds.height-80)});
  win.show();win.setFullScreen(true);this.#ambient=true;this.changed();
  if(!this.#ambientWatch){this.#ambientWatch=true;win.on('leave-full-screen',()=>{if(this.#ambient){this.#ambient=false;void win.webContents.executeJavaScript(ambientScript(false),true).catch(()=>{});this.changed();}});}
  let r:{ok?:boolean}|null=null;try{r=await win.webContents.executeJavaScript(ambientScript(true),true);}catch{}
  return !!r?.ok;
 }
 #ambientWatch=false;
 /** Replay: tours the stops in order (runs in the background; the window shows it). */
 async replay(stops:readonly ReplayStop[],layers:readonly string[]=[]):Promise<void>{
  await this.show({layers:[...layers],place:'',view:null});const w=this.#win;if(!w||w.isDestroyed())return;
  void w.webContents.executeJavaScript(replayScript(stops),true).catch(()=>{});
 }
 /** Reloads with the current Lite setting (it applies at load). */
 async reloadLite(){const w=this.#win;if(!w||w.isDestroyed())return;await w.loadURL(`${this.gev.origin}/?lite=${this.lite()?1:0}`).catch(()=>{});}
 async close():Promise<boolean>{const w=this.#win;if(!w||w.isDestroyed())return false;w.close();return true;}
}
