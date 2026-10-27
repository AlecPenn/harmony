// God's Eye layer probe (Claude, October 26). Run with HARMONY's Electron: it starts God's Eye View on a spare port,
// opens it, switches each layer on for a few seconds and records how long the page froze (Chromium "long tasks",
// over 50 ms each) and the frame rate, then writes .runtime/gev-layer-probe.json. Read-only; nothing is saved.
// Usage: node_modules\electron\dist\electron.exe scripts\gods-eye-layer-probe.cjs [lite=1|0] [profile=<layer id>]
// profile=<layer>: only that layer, with Chromium's CPU profiler on; the busiest functions go in
// .runtime/gev-profile-<layer>.json.
const {app,BrowserWindow,session}=require('electron');
const {spawn}=require('node:child_process');
const {writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const root=resolve(__dirname,'..'),pin=require(join(root,'docs','GODS-EYE-VIEW.json'));
const dir=resolve(root,pin.folder),port=4198,lite=(process.argv.find(a=>/^lite=/.test(a))??'lite=1').slice(5);
const profileLayer=(process.argv.find(a=>/^profile=/.test(a))??'').slice(8).replace(/[^a-z0-9-]/g,'');
const out=join(root,'.runtime',profileLayer?`gev-profile-${profileLayer}.json`:`gev-layer-probe${lite==='1'?'':'-full'}.json`),report={lite,started:new Date().toISOString(),idle:null,layers:[]};
const save=()=>{try{writeFileSync(out,JSON.stringify(report,null,1));}catch{}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const vite=spawn('node',[join(dir,'node_modules','vite','bin','vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:dir,windowsHide:true,stdio:'ignore',env:{...process.env,BROWSER:'none'}});
 const quit=()=>{try{vite.kill();}catch{}app.quit();};
 try{
  for(let i=0;i<120;i++){try{const r=await fetch(`http://127.0.0.1:${port}/`);if(r.ok)break;}catch{}await sleep(500);}
  const ses=session.fromPartition('probe');ses.setPermissionRequestHandler((_c,_p,cb)=>cb(false));
  const win=new BrowserWindow({width:1500,height:920,show:true,webPreferences:{session:ses,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  await win.loadURL(`http://127.0.0.1:${port}/?lite=${lite}`);
  const js=s=>win.webContents.executeJavaScript(s,true);
  for(let i=0;i<180;i++){if(await js('!!(window.__godsEyeView&&window.__godsEyeView.voiceCommands)'))break;await sleep(1000);}
  await sleep(8000);
  await js(`(()=>{const p=window.__probe={long:[],frames:0};new PerformanceObserver(l=>{for(const e of l.getEntries())p.long.push([e.startTime,e.duration]);}).observe({type:'longtask',buffered:false});const f=()=>{p.frames++;requestAnimationFrame(f);};requestAnimationFrame(f);return true;})()`);
  const window_=async(ms)=>{const a=await js('[performance.now(),window.__probe.frames]');await sleep(ms);const b=await js('[performance.now(),window.__probe.frames]');
   const lt=await js(`window.__probe.long.filter(x=>x[0]>=${a[0]}&&x[0]<=${b[0]}).map(x=>x[1])`);
   return {fps:Math.round((b[1]-a[1])*1000/(b[0]-a[0])),frozenMs:Math.round(lt.reduce((s,x)=>s+x,0)),longest:Math.round(Math.max(0,...lt)),longTasks:lt.length};};
  report.idle=await window_(6000);save();
  if(profileLayer){
   const dbg=win.webContents.debugger;dbg.attach('1.3');await dbg.sendCommand('Profiler.enable');await dbg.sendCommand('Profiler.setSamplingInterval',{interval:500});
   await dbg.sendCommand('Profiler.start');const a=await js('performance.now()');
   await js(`window.__godsEyeView.voiceCommands.runner('set_layer_visibility',{layerId:${JSON.stringify(profileLayer)},enabled:true},{}).then(()=>true,()=>false)`);
   await sleep(12000);const {profile}=await dbg.sendCommand('Profiler.stop');const b=await js('performance.now()');
   const lt=await js(`window.__probe.long.filter(x=>x[0]>=${a}&&x[0]<=${b}).map(x=>x[1])`);
   // Self time per function (samples x interval), and total time including callees for the top functions.
   const byId=new Map(profile.nodes.map(n=>[n.id,n])),self=new Map(),dt=new Map();
   for(let i=0;i<profile.samples.length;i++)dt.set(profile.samples[i],(dt.get(profile.samples[i])??0)+(profile.timeDeltas[i+1]??0)/1000);
   const key=n=>`${n.callFrame.functionName||'(anonymous)'} ${n.callFrame.url.replace(/^.*?\/(src|node_modules)\//,'$1/').replace(/\?.*$/,'')}:${n.callFrame.lineNumber+1}`;
   for(const [id,ms] of dt){const n=byId.get(id);if(n)self.set(key(n),(self.get(key(n))??0)+ms);}
   const parent=new Map();for(const n of profile.nodes)for(const c of n.children??[])parent.set(c,n.id);
   const total=new Map();for(const [id,ms] of dt){const seen=new Set();let cur=id;while(cur!==undefined){const n=byId.get(cur);if(!n)break;const k=key(n);if(!seen.has(k)){seen.add(k);total.set(k,(total.get(k)??0)+ms);}cur=parent.get(cur);}}
   const top=(m,n)=>[...m].sort((x,y)=>y[1]-x[1]).slice(0,n).map(([k,v])=>[k,Math.round(v)]);
   report.profile={layer:profileLayer,frozenMs:Math.round(lt.reduce((s,x)=>s+x,0)),longest:Math.round(Math.max(0,...lt)),self:top(self,45),total:top(total,60)};
   report.finished=new Date().toISOString();save();quit();return;
  }
  const layers=await js('window.__godsEyeView.dataManager.getAll().filter(l=>l.showInTogglePanel&&!l.enabled).map(l=>({id:l.id,name:l.name}))');
  for(const l of layers){
   const run=(on)=>js(`window.__godsEyeView.voiceCommands.runner('set_layer_visibility',{layerId:${JSON.stringify(l.id)},enabled:${on}},{}).then(()=>true,()=>false)`);
   const t=Date.now();await run(true);const enableMs=Date.now()-t;
   const m=await window_(9000);
   const stats=await js(`(()=>{const x=window.__godsEyeView.dataManager.getAll().find(y=>y.id===${JSON.stringify(l.id)});return x?{state:x.lifecycleState,count:x.stats&&(x.stats.count??x.stats.visible??null),keyRequired:!!(x.stats&&x.stats.keyRequired)}:null;})()`);
   await run(false);await sleep(2500);
   report.layers.push({...l,enableMs,...m,...stats});save();
  }
  report.finished=new Date().toISOString();save();
 }catch(e){report.error=String(e&&e.message||e);save();}
 quit();
});
