import type {Snapshot} from '../../../packages/contracts/index.ts';
import {execFile} from 'node:child_process';
import {WifiReconnect,parseInterfaces,connectArgs} from '../../../core/wifi-reconnect.ts';
import {ModelHealth} from '../../../packages/reasoning/model-health.ts';
import {openDatabase} from '../../../core/storage.ts';
import {ReasoningBudget} from '../../../core/reasoning-budget.ts';
import {AllowanceController} from '../../../core/allowance-controller.ts';
import {OwnerVerification} from '../../../core/owner-verification.ts';
import {NativeOwnerWorker} from '../../../core/native-owner.ts';
import {ResponsesTokenCounter} from '../../../packages/reasoning/token-count.ts';
import {desktopDataRoot} from '../../../core/desktop-data.ts';
import {ReasoningController} from '../../../core/reasoning-controller.ts';
import {ReasoningConnectionStore} from '../../../core/reasoning-connection-store.ts';
import {LocalModelServer,localModelRoot,readLocalInstall} from '../../../core/local-model.ts';
import {LocalReasoningController} from '../../../core/local-reasoning.ts';
import {ConversationController} from '../../../core/conversation.ts';
import {ConversationSpeech} from '../../../core/conversation-speech.ts';
import {LocalChatClient} from '../../../packages/reasoning/local-chat.ts';
import {validateLocalVoiceEngine} from '../../../packages/contracts/voice-output.ts';
import {ReadOnlyFiles} from '../../../packages/files/read-only.ts';
import {VoiceConnectionStore} from '../../../core/voice-connection-store.ts';
import {windowsProfileCipher} from './profile-cipher.ts';
import { SpeechOutputs } from '../../../core/speech-outputs.ts';
import { validatePreset, validateVoiceRequest } from '../../../packages/contracts/voice-output.ts';
import { app, BrowserWindow, ipcMain, session, screen, dialog, Notification, shell, powerMonitor, safeStorage, net } from 'electron';
import {ReminderStore,ReminderScheduler,ReminderInputError,type Reminder} from '../../../core/reminders.ts';
import {MemoryStore} from '../../../core/memory.ts';
import {LocalEmbedder} from '../../../core/embedder.ts';
import {Recall,EPISODE_DAYS} from '../../../core/recall.ts';
import {Desktop,PowerShellTransport} from '../../../core/desktop.ts';
import {WorkspaceStore} from '../../../core/workspace.ts';
import {InterruptionEngine,CalendarWatcher,inQuietHours} from '../../../core/interruptions.ts';
import {ScreenWatcher} from '../../../core/observation.ts';
import {MissionStore,MissionRunner} from '../../../core/missions.ts';
import {SkillRegistry,SKILLS} from '../../../core/skills.ts';
import {mediaItems} from '../../../core/media.ts';
import {Personality,EasterEggs,PROFILES,TRAITS,type Profile} from '../../../core/personality.ts';
import {ArrivalTracker,arrivalSummary} from '../../../core/arrival.ts';
import {diagnose} from '../../../core/diagnostics.ts';
import {Backups} from '../../../core/backup.ts';
import {CompanionAuth,CompanionServer} from '../../../core/companion.ts';
import {Guardian,GuardDenied,vector} from '../../../core/guardian.ts';
import {GuardWorker,guardModels} from '../../../core/guard-worker.ts';
import {GodsEye} from '../../../core/gods-eye.ts';
import {distrustPatterns,distrustInNode,chainDistrusted} from '../../../core/tls-trust.ts';
import {WorldFeeds} from '../../../core/world-feeds.ts';
import {MadisonMetro} from '../../../core/metro.ts';
import {readProfile,writeHome} from '../../../core/profile.ts';
import {WorldKeyStore,gevEnv} from '../../../core/world-keys.ts';
import {WatchZones} from '../../../core/watch-zones.ts';
import {MorningBrief} from '../../../core/morning-brief.ts';
import {SelfCheck} from '../../../core/self-check.ts';
import {SpiralTime} from '../../../core/spiral-time.ts';
import {Updater,type UpdateStatus} from '../../../core/updater.ts';
import {WorkLog} from '../../../core/worklog.ts';
import {JobScout} from '../../../core/job-scout.ts';
import {GestureStore,GestureTracker,watchFor,type Sign} from '../../../core/gestures.ts';
import {NetworkWatch,parseScan,alertText} from '../../../core/network-watch.ts';
import {RoutineStore,describeSteps} from '../../../core/routines.ts';
import {ClaudeBriefs} from '../../../core/claude-brief.ts';
import {WakeLearner} from '../../../core/wake-learner.ts';
import {SecurityDrills,drillSummary} from '../../../core/security-drills.ts';
import {Connectivity,connectivityText} from '../../../core/connectivity.ts';
import {SpeedScoreboard} from '../../../core/speed-scoreboard.ts';
import {triage,briefText,draftPrompt,cleanDraft,composeUrl,replySubject,type TriageResult,type Draft} from '../../../core/inbox-triage.ts';
import {OffsiteBackups,WrongKey,type OffsiteStatus} from '../../../core/offsite-backup.ts';
import {pickOrbDisplay,orbBounds,readOrbSettings,type OrbSettings,type DisplayInfo} from '../../../core/orb-display.ts';
import {planDrift,glide,type DriftMode} from '../../../core/drift.ts';
import {GodsEyeWindow} from './gods-eye-window.ts';
import {ModeStore,IdeaStore,MODES,IDEA_STAGES,type HarmonyMode,type IdeaStage} from '../../../core/modes.ts';
import {WebLookup} from '../../../core/web.ts';
import {GoogleAccount,GoogleError,type GoogleCapability} from '../../../core/google.ts';
import {ProjectStore,WORLDS,type NoteKind,type World} from '../../../core/projects.ts';
import {readFileSync,writeFileSync} from 'node:fs';
import {AssistantActions} from '../../../core/assistant-actions.ts';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Runtime } from '../../../core/runtime.ts';
import { ConfigStore } from '../../../packages/config/store.ts';
import { PythonWorker } from '../../../core/worker.ts';
import { trustedSender, validateNoArguments } from '../../../core/ipc-policy.ts';
import { SpeechWorker } from '../../../core/speech-worker.ts';
import { audioPermission } from '../../../packages/contracts/audio.ts';

const root = app.getAppPath();
const dataRoot = desktopDataRoot(root, app.isPackaged, process.env.HARMONY_TEST_PROFILE);
mkdirSync(join(dataRoot, 'desktop-profile'), { recursive: true });
app.setPath('userData', join(dataRoot, 'desktop-profile'));
app.setName('HARMONY');
const hasLock = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let companion: BrowserWindow | null = null;
let orb: BrowserWindow | null = null;
let runtime: Runtime | null = null;
let closing = false;
let budgetDatabase:ReturnType<typeof openDatabase>|null=null;
let memoryEmbedder:LocalEmbedder|null=null;
let desktop:Desktop|null=null;
let watchers:{stop():void}[]=[];
// STOP cuts off a research step in progress; the mission keeps its checkpoint and continues after Resume.
let haltMissions=()=>{};
let reminderScheduler:ReminderScheduler|null=null;

if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    // Step 29: a startup timeline (milliseconds since the app process started), saved to .runtime/startup.json.
    const marks:[string,number][]=[];const mark=(name:string)=>{marks.push([name,Math.round(process.uptime()*1000)]);};mark('electron ready');
    let microphoneUntil=0,guardMicUntil=0,cameraUntil=0,gestureWatching=()=>false;
    const files=new ReadOnlyFiles();let fileRoot:string|null=null,fileGeneration=0,choosingFolder=false;
    const revokeFiles=()=>{fileGeneration++;fileRoot=null;files.revokeRoot('workspace');};
    let reasoningSettingsBusy=false;
    const reasoningConnection=new ReasoningConnectionStore(join(dataRoot,'credentials','reasoning.enc'),windowsProfileCipher);
    const voiceConnection=new VoiceConnectionStore(join(dataRoot,'credentials','speech.enc'),windowsProfileCipher);
    // Backups: a restore chosen in Settings is applied here, before the database opens.
    const backups=new Backups(join(dataRoot,'backups'),join(dataRoot,'database','harmony.sqlite'),join(dataRoot,'config','settings.json'));
    let restored=false;try{restored=backups.applyPendingRestore();}catch{}
    // Step 16: encrypted copies off this disk (OneDrive folder, another drive, a USB stick), with Alec's recovery key.
    const offsite=new OffsiteBackups(join(dataRoot,'credentials','offsite.enc'),windowsProfileCipher);
    let offsiteState:OffsiteStatus|null=null;
    // Places for off-PC backups: OneDrive and the PC's other local or removable drives. Drives are listed by Windows
    // (one quick, cached query) instead of touching every drive letter, because touching a disconnected network drive
    // or an empty card reader blocks for seconds and froze the whole window when Settings opened.
    let placesCache:{at:number;list:{path:string;label:string}[]}|null=null;
    const offsitePlaces=async():Promise<{path:string;label:string}[]>=>{
      if(placesCache&&Date.now()-placesCache.at<60000)return placesCache.list;
      const out:{path:string;label:string}[]=[];const sys=(process.env.SystemDrive||'C:').toUpperCase();
      for(const v of [process.env.OneDrive,process.env.OneDriveConsumer,process.env.OneDriveCommercial])if(v&&!out.some(o=>o.path===v)&&await import('node:fs/promises').then(f=>f.stat(v)).then(()=>true,()=>false))out.push({path:v,label:`OneDrive (syncs to the cloud): ${v}`});
      if(process.platform==='win32'){
        const drives=await new Promise<string>(resolve=>execFile(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
          ['-NoLogo','-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2 or DriveType=3" | Where-Object { $_.Size -gt 0 } | ForEach-Object { $_.DeviceID }'],
          {windowsHide:true,timeout:8000},(_e,stdout)=>resolve(String(stdout??''))));
        for(const id of drives.split(/\r?\n/).map(x=>x.trim().toUpperCase()).filter(x=>/^[D-Z]:$/.test(x)&&x!==sys))out.push({path:`${id}\\`,label:`${id} drive`});
      }
      placesCache={at:Date.now(),list:out.slice(0,10)};return placesCache.list;
    };
    const offsiteFiles=()=>{
      const newest=backups.list()[0];if(!newest)return null;
      const db=readFileSync(join(dataRoot,'backups',newest.name)),settingsPath=join(dataRoot,'backups',newest.name.replace(/\.sqlite$/,'.settings.json'));
      return {'harmony.sqlite':db,...(existsSync(settingsPath)?{'settings.json':readFileSync(settingsPath)}:{})};
    };
    const offsiteTick=async(force=false)=>{
      try{if(budgetDatabase)backups.daily(budgetDatabase);const f=offsiteFiles();if(f)await offsite.run(f,force);}catch{}
      try{offsiteState=await offsite.status();}catch{}runtime?.publish();
    };
    const offsiteTimer=setInterval(()=>{void offsiteTick();},60*60000);offsiteTimer.unref?.();setTimeout(()=>{void offsiteTick();},90000).unref?.();
    budgetDatabase=openDatabase(join(dataRoot,'database','harmony.sqlite'));
    mark('database open');
    setTimeout(()=>{try{if(budgetDatabase)backups.daily(budgetDatabase);runtime?.publish();}catch{}},30000).unref?.();
    const budget=new ReasoningBudget(budgetDatabase);budget.recover();
    const modelHealth=new ModelHealth();
    const reasoning=new ReasoningController(async()=>(await reasoningConnection.read())?.key??null,()=>runtime?.publishReasoning(),undefined,{counter:new ResponsesTokenCounter()},budget,modelHealth);
    const localServer=new LocalModelServer(()=>readLocalInstall(localModelRoot(root)),()=>runtime?.publishLocal());
    // Reminders and timers live in the same local database; the scheduler starts once the runtime is booted.
    const reminderStore=new ReminderStore(budgetDatabase);
    const memoryStore=new MemoryStore(budgetDatabase);
    const projectStore=new ProjectStore(budgetDatabase);try{projectStore.seed();}catch{}
    memoryStore.currentProject=()=>projectStore.activeId();
    // Meaning-based memory search, on this PC only. Without the model (not set up yet), recall uses words alone.
    memoryEmbedder=new LocalEmbedder(root,{onState:()=>runtime?.publish()});
    const recall=new Recall(budgetDatabase,memoryStore,projectStore,memoryEmbedder);
    // Screen and computer control: Windows only, through one fixed helper script. Settings live in the local database.
    desktop=new Desktop(process.platform==='win32'?new PowerShellTransport(root):null,budgetDatabase,()=>runtime?.publish());
    const modes=new ModeStore(budgetDatabase,undefined,()=>runtime?.publish()),ideas=new IdeaStore(budgetDatabase),missions=new MissionStore(budgetDatabase);
    const work=new WorkLog(budgetDatabase);
    // Spiral Time: "Spiral Time" at night hands background jobs to Claude through the handoff folder (see core/spiral-time.ts).
    // Step 24: the remote job scout rides along with Spiral Time about once a week.
    // Slow-changing parts of the snapshot are rebuilt at most every few seconds (they read files and the database).
    const cache=new Map<string,{at:number;value:unknown}>();
    const cached=<T,>(key:string,ms:number,make:()=>T):T=>{const c=cache.get(key);if(c&&Date.now()-c.at<ms)return c.value as T;const value=make();cache.set(key,{at:Date.now(),value});return value;};
    const jobScout=new JobScout(budgetDatabase,undefined,readProfile(root).job);
    // Step 27: skills Alec teaches by describing them; drafts run only after he approves them on the screen.
    const routines=new RoutineStore(budgetDatabase);
    // Claude's daily brief: a scheduled task writes handoff/brief/brief-<date>.json before 5 AM; she reads it after her own.
    const dailyBrief=new ClaudeBriefs(join(root,'handoff'));
    const spiral=new SpiralTime(join(root,'handoff'),budgetDatabase,missions,undefined,jobScout);
    const personality=new Personality(budgetDatabase,()=>runtime?.publish()),eggs=new EasterEggs(()=>personality.status().profile);
    let flourish:{kind:string;at:string}|null=null;const bootLine=eggs.bootLine();
    // Skills that need something set up or connected show as not available until it is.
    const skills=new SkillRegistry(budgetDatabase,id=>id==='godseye'?godsEye.installed:id==='calendar'?google.has('calendar'):id==='email'?google.has('gmail'):['screen','computer','workspace'].includes(id)?desktop!.available:true,()=>runtime?.publish());
    const google=new GoogleAccount(join(dataRoot,'credentials','google.enc'),{available:windowsProfileCipher.available,encrypt:windowsProfileCipher.encrypt,decrypt:windowsProfileCipher.decrypt});
    void google.status().then(()=>runtime?.publish()).catch(()=>{});
    // Step 18: inbox and calendar triage (read-only Google; sorting on this PC; drafts by the local brain on request).
    let inboxState:TriageResult|null=null,inboxBusy:Promise<TriageResult|null>|null=null;
    const drafts=new Map<string,Draft>();
    const refreshInbox=(signal?:AbortSignal):Promise<TriageResult|null>=>{
      if(inboxBusy)return inboxBusy;
      inboxBusy=(async()=>{
        if(!google.has('gmail')&&!google.has('calendar'))return null;
        const now=new Date(),end=new Date(now);end.setHours(23,59,59,999);
        const st=await google.status().catch(()=>null);
        const [mail,events]=await Promise.all([google.has('gmail')?google.messages('in:inbox is:unread newer_than:1d',30,signal):Promise.resolve([]),google.has('calendar')?google.events({start:new Date(now.getTime()-3600000),end},signal??new AbortController().signal):Promise.resolve([])]);
        inboxState=triage(mail,st?.email??null,events,now);for(const k of [...drafts.keys()])if(!inboxState.needsYou.concat(inboxState.fyi).some(m=>m.id===k))drafts.delete(k);
        runtime?.publish();return inboxState;
      })().catch(e=>{inboxState={...(inboxState??{at:new Date().toISOString(),needsYou:[],fyi:[],skipped:0,today:[]}),error:e instanceof GoogleError?e.message:'Could not check Google right now.'};runtime?.publish();return null;})
        .finally(()=>{inboxBusy=null;});
      return inboxBusy;
    };
    const inbox={brief:async(signal:AbortSignal)=>{const r=await refreshInbox(signal);return r?briefText(r):'Google isn\'t connected, or couldn\'t be reached.';}};
    const inboxTimer=setInterval(()=>{const h=new Date().getHours();if(h>=6&&h<22)void refreshInbox();},30*60000);inboxTimer.unref?.();setTimeout(()=>{void refreshInbox();},45000).unref?.();
    // Security (the guardian): voice and face checks, phone approvals, locks. Prints stay sealed on this PC.
    const guardWorker=new GuardWorker(root);let models=guardModels(root);
    const modelTimer=setInterval(()=>{models=guardModels(root);},60000);modelTimer.unref?.();
    const guardAlerts:{text:string;at:string}[]=[];
    let selfCheck:SelfCheck|null=null;
    let drillsRef:SecurityDrills|null=null;
    // Step 22: offline mode. Windows' own network state, then two well-known endpoints (either answering is enough).
    let sayConnectivity:(text:string)=>void=()=>{};
    const connectivity=new Connectivity(async()=>{
      if(!net.isOnline())return false;
      const hit=(u:string)=>fetch(u,{method:'GET',signal:AbortSignal.timeout(5000),headers:{'User-Agent':'HARMONY/1 connectivity'}}).then(r=>r.status<500,()=>false);
      return (await Promise.all([hit('https://www.gstatic.com/generate_204'),hit('https://1.1.1.1/cdn-cgi/trace')])).some(Boolean);
    },(online,down)=>{
      const queued=online?missions.open().filter(m=>m.objective.startsWith('Look up: ')).length:0;
      guardian.log('network',online?'Internet back':'Internet down');sayConnectivity(connectivityText(online,down,queued));runtime?.publish();
    });
    connectivity.start();
    // Step 26: the Wi-Fi watchdog. A fixed, read-only script lists the devices on the home network every 5 minutes (with a
    // quick ping sweep every 30, so quiet devices show up). New devices after the first look raise one alert.
    const network=new NetworkWatch(budgetDatabase);let networkScanning:Promise<void>|null=null,lastSweep=0;
    const networkOn=()=>{try{return (budgetDatabase!.prepare("SELECT value FROM memory_settings WHERE key='network_watch_on'").get() as {value?:string}|undefined)?.value!=='0';}catch{return true;}};
    const scanNetwork=(sweep=false):Promise<void>=>{
      if(process.platform!=='win32'||!networkOn())return Promise.resolve();
      if(networkScanning)return networkScanning;
      const doSweep=sweep||Date.now()-lastSweep>30*60000;if(doSweep)lastSweep=Date.now();
      networkScanning=new Promise<void>(resolve=>{
        execFile(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
          ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'workers','network','neighbors.ps1'),...(doSweep?['-Sweep']:[])],
          {windowsHide:true,timeout:30000,maxBuffer:2_000_000},(error,stdout)=>{
            const r=error?{error:'The network scan didn\'t finish.'}:parseScan(String(stdout));
            if('error' in r)network.failed(r.error);
            else{const {fresh}=network.record(r);if(fresh.length){guardian.log('network',alertText(fresh,r.ssid));interruptions.raise({source:'system',key:`wifi:${fresh.map(d=>d.mac).join(',')}`,text:alertText(fresh,r.ssid),importance:.8,urgency:.6,confidence:.9,relevance:1,expiresAt:Date.now()+6*3600000});}}
            cache.delete('network');runtime?.publish();resolve();
          });
      }).finally(()=>{networkScanning=null;});
      return networkScanning;
    };
    const networkTimer=setInterval(()=>{void scanNetwork();},5*60000);networkTimer.unref?.();
    setTimeout(()=>{void scanNetwork(true);},5*60000).unref?.(); // after startup has settled
    // Wi-Fi reconnect (Alec, October 26; core/wifi-reconnect.ts): reads the adapter's state with netsh every 15 s and, if
    // it sits disconnected, reconnects it to the saved network it was on. On unless switched off in the Wi-Fi panel.
    const getSetting=(key:string)=>{try{return (budgetDatabase!.prepare('SELECT value FROM memory_settings WHERE key=?').get(key) as {value?:string}|undefined)?.value??null;}catch{return null;}};
    const putSetting=(key:string,value:string)=>budgetDatabase!.prepare('INSERT INTO memory_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
    const reconnectOn=()=>getSetting('wifi_reconnect_on')!=='0';
    const wifi=new WifiReconnect(getSetting('wifi_profile'),p=>{try{putSetting('wifi_profile',p);}catch{}});
    const netsh=join(process.env.SystemRoot??'C:\\Windows','System32','netsh.exe');
    let wifiBusy=false,wifiState='';
    const wifiTick=()=>{
      if(process.platform!=='win32'||wifiBusy)return;wifiBusy=true;
      execFile(netsh,['wlan','show','interfaces'],{windowsHide:true,timeout:8000,maxBuffer:200_000},(error,stdout)=>{
        try{
          const r=wifi.tick(error?{kind:'unknown'}:parseInterfaces(String(stdout)),reconnectOn());
          const args=r.action?connectArgs(r.action.connect):null;
          if(r.action&&args){
            guardian.log('network',`Reconnecting Wi-Fi to "${r.action.connect.profile}"`);
            // Both names passed safeName (no quotes or control characters), so the quoted command line is exact.
            execFile(netsh,args,{windowsHide:true,timeout:15000,windowsVerbatimArguments:true},()=>{setTimeout(wifiTick,5000).unref?.();});
          }
          if(r.tell){
            guardian.log('network',r.tell.text);
            if(r.tell.kind!=='reconnecting')interruptions.raise({source:'system',key:`wifi-reconnect:${r.tell.at}`,text:r.tell.text,importance:r.tell.kind==='reconnected'?.5:.8,urgency:.5,confidence:.95,relevance:1,expiresAt:Date.now()+3*3600000});
          }
          const state=wifi.view(true).state;if(state!==wifiState){wifiState=state;cache.delete('network');runtime?.publish();}
        }catch{}finally{wifiBusy=false;}
      });
    };
    const wifiTimer=setInterval(wifiTick,15000);wifiTimer.unref?.();setTimeout(wifiTick,3000).unref?.();
    // One-click updates: build the folder's newest commit beside the running version, then restart into it.
    const updater=new Updater(root);
    let raiseNotice:(key:string,text:string,importance:number)=>void=()=>{};
    const restartSoon=()=>{setTimeout(()=>{app.relaunch();app.quit();},2500);};
    // Updating changes HARMONY's own code, so it's approved like a security change (your phone, when one is paired).
    async function applyUpdate():Promise<string>{
      const u=updater.status();
      if(u.state==='building')return 'Already updating. I\'ll restart when it\'s built.';
      if(!u.available&&u.state!=='ready')return 'I\'m already up to date.';
      await guardian.sensitive('Update HARMONY');
      if(u.state==='ready'){restartSoon();return 'Restarting into the update now.';}
      void updater.build().then(ok=>{cache.delete('update');runtime?.publish();
        if(ok){guardian.log('update',`Updated to ${updater.status().head?.slice(0,7)}`);restartSoon();}
        else raiseNotice(`update-failed:${Date.now()}`,`The update didn't build, so nothing changed. ${updater.status().error??''}`.slice(0,300),.7);});
      runtime?.publish();
      return 'Updating. I\'ll keep working while it builds, then restart in about a minute.';
    }
    async function undoUpdate():Promise<string>{
      await guardian.sensitive('Undo the last update');
      if(!updater.requestUndo())return 'There\'s no earlier version to go back to.';
      guardian.log('update','Rolled back to the previous version');restartSoon();return 'Going back to the previous version. Restarting now.';
    }
    let challengeMic:(on:boolean)=>boolean=()=>false; // set once the conversation exists
    const guardian=new Guardian(budgetDatabase,windowsProfileCipher,{
      phonePaired:()=>{try{return phone.enabled&&companionAuth.signing;}catch{return false;}},
      alert:text=>{guardAlerts.unshift({text:text.slice(0,200),at:new Date().toISOString()});guardAlerts.length=Math.min(guardAlerts.length,5);
        try{if(Notification.isSupported())new Notification({title:'HARMONY security',body:text.slice(0,200),silent:false}).show();}catch{}
        try{if(window&&!window.isDestroyed()&&!window.isFocused())window.flashFrame(true);}catch{}},
      changed:()=>runtime?.publish(),models:()=>models,listen:on=>challengeMic(on)});
    void guardian.load().catch(()=>{});
    // Distrusted certificate authorities (docs/DISTRUSTED-CAS.json, e.g. eMudhra after its October 2026 key compromise):
    // removed from Node's trust store, and any Chromium chain that includes one is refused, in every HARMONY window.
    const caPatterns=distrustPatterns(root);
    const nodeTrust=distrustInNode(caPatterns);
    if(nodeTrust?.removed.length)guardian.log('trust',`Distrusted ${nodeTrust.removed.length} certificate authorities: ${nodeTrust.removed.join(', ').slice(0,150)}`);
    let lastBlocked='';
    const verifyChain=(request:Electron.Request&{hostname:string;certificate:Electron.Certificate},callback:(code:number)=>void)=>{
      if(chainDistrusted(request.certificate as never,caPatterns)){
        if(lastBlocked!==request.hostname){lastBlocked=request.hostname;guardian.log('trust',`Refused ${request.hostname.slice(0,80)}: its certificate comes from a distrusted authority`);}
        callback(-2);return;
      }
      callback(-3); // otherwise Chromium's own verification decides
    };
    session.defaultSession.setCertificateVerifyProc(verifyChain as never);
    session.fromPartition('persist:godseye').setCertificateVerifyProc(verifyChain as never);
    // God's Eye View: installed by "Set up God's Eye", started only when asked, in its own window.
    // World data keys (from God's Eye v9): Windows-encrypted, names only ever shown.
    const worldKeys=new WorldKeyStore(join(dataRoot,'credentials','world-keys.enc'),windowsProfileCipher);
    const godsEye=new GodsEye(root,{changed:()=>runtime?.publish(),env:async()=>gevEnv(await worldKeys.keys())});
    const godsEyeWindow=new GodsEyeWindow(godsEye,()=>runtime?.publish());
    godsEyeWindow.lite=()=>{try{return (budgetDatabase!.prepare("SELECT value FROM memory_settings WHERE key='gods_eye_lite'").get() as {value?:string}|undefined)?.value!=='0';}catch{return true;}};
    const worldFeeds=new WorldFeeds({keys:()=>worldKeys.keys()});
    mark('core services');
    // Watch zones speak through the interruption engine (quiet hours, focus and ghost mode are respected).
    const watch=new WatchZones(budgetDatabase,worldFeeds,n=>interruptions.raise({source:'system',key:`watch:${n.key}`,text:n.text,importance:n.severity,urgency:n.severity>=.8?1:.6,confidence:1,relevance:.9,expiresAt:Date.now()+3*3600000}),{changed:()=>runtime?.publish()});
    const actions=new AssistantActions(reminderStore,budgetDatabase,()=>{reminderScheduler?.check();runtime?.publish();},undefined,memoryStore,new WebLookup(),google,projectStore,recall,desktop,new WorkspaceStore(budgetDatabase,projectStore),{home:()=>readProfile(root).home?.place,modes,ideas,missions,spiral,routines,dailyBrief,jobs:jobScout,network:{spoken:()=>network.spoken(),scan:()=>scanNetwork()},work,inbox,offline:{online:()=>connectivity.online,failed:()=>connectivity.failed()},drills:{run:async()=>{if(!drillsRef)return 'Security drills aren\'t ready yet.';return drillSummary(await drillsRef.run());}},update:{status:()=>updater.status(),apply:()=>applyUpdate(),undo:()=>undoUpdate()},skills,personality,eggs,onFlourish:kind=>{flourish={kind,at:new Date().toISOString()};runtime?.publish();},
      diagnostics:()=>[diagnose(conversation.lastTurn,conversation.snapshot().startup,localServer.snapshot().loadMs),(()=>{try{return speedBoard.board().summary;}catch{return '';}})(),(()=>{try{const r=selfCheck?(Date.now()-Date.parse(selfCheck.last?.at??'0')>10*60000?selfCheck.run():selfCheck.last):null;return r?r.summary:'';}catch{return '';}})()].filter(Boolean).join('\n'),guard:guardian,
      world:worldFeeds,watch,metro:new MadisonMetro(join(root,'data','metro')),godsEye:{available:()=>godsEye.installed,open:v=>godsEyeWindow.show(v),close:()=>godsEyeWindow.close(),call:(t,a,sig)=>godsEye.call(t,a,sig),gnss:(lat,lon,sig)=>godsEye.gnss(lat,lon,sig),ambient:on=>godsEyeWindow.setAmbient(on),replay:(stops,layers)=>godsEyeWindow.replay(stops,layers)}});
    const local=new LocalReasoningController(localServer,()=>runtime?.publishLocal(),undefined,512,actions);
    const nativeOwner=new NativeOwnerWorker(root);
    // Checked in the background: probing Windows Hello took seconds and held up the window.
    let ownerAvailable=false;mark('before owner probe');void nativeOwner.probe().then(value=>{ownerAvailable=value.available;mark('owner probe done');},()=>{});
    const owner=new OwnerVerification(join(dataRoot,'credentials','owner.enc'),windowsProfileCipher,nativeOwner.verify,()=>{
      if(!window||window.isDestroyed())throw new Error('Owner window unavailable');
      const handle=window.getNativeWindowHandle();return (handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
    });
    const allowance=new AllowanceController(budget,owner,()=>runtime?.publishAllowance());
    const ownerLifecycle={get active(){return owner.active||nativeOwner.active;},async stop(){await owner.stop();if(nativeOwner.active)throw new Error('Owner verifier still active');}};
    const output=new SpeechOutputs(root,()=>runtime?.publishOutput());
    const speech=new SpeechWorker(root,()=>runtime?.publishAudio());
    app.on('before-quit',()=>speech.dropStandby()); // the standby speech worker never outlives HARMONY
    const conversationSpeech=new ConversationSpeech(root);
    const speedBoard=new SpeedScoreboard(budgetDatabase,()=>updater.built()?.slice(0,7)??null);
    const conversation=new ConversationController(speech,localServer,new LocalChatClient(),conversationSpeech,()=>runtime?.publishConversation(),320,700,undefined,actions);
    // Step 19: the wake word that keeps learning Alec. Its examples are sealed with Windows encryption.
    const wakeFile=join(dataRoot,'credentials','wake-profile.enc');
    const wake=new WakeLearner(windowsProfileCipher,{read:async()=>{const {readFile}=await import('node:fs/promises');try{return await readFile(wakeFile);}catch{return null;}},
      write:async d=>{const {writeFile,rename,mkdir}=await import('node:fs/promises');await mkdir(join(dataRoot,'credentials'),{recursive:true});await writeFile(wakeFile+'.tmp',d);await rename(wakeFile+'.tmp',wakeFile);},
      clear:async()=>{const {unlink}=await import('node:fs/promises');await unlink(wakeFile).catch(()=>{});}});
    void wake.load().then(()=>runtime?.publish()).catch(()=>{});
    speech.wakeLearner=wake;
    speech.voiceprint={enabled:()=>guardian.voiceActive,heard:(segment,embedding)=>guardian.voice(segment,vector(embedding,256))};
    conversation.guard={verdict:segment=>guardian.verdict(segment),intercept:(text,v)=>guardian.intercept(text,v),guest:v=>guardian.guest(v),
      ignoreStrangers:()=>guardian.ignoreStrangers(),begin:(c,v)=>guardian.begin(c,v),wake:()=>guardian.requestFace(),
      spoken:(text,segment)=>{void guardian.spoken(text,segment).catch(()=>{});}};
    challengeMic=on=>conversation.challenge(on);
    // Step 25: hand signs. The camera is open only while a sign could mean something (see core/gestures.ts).
    const gestures=new GestureStore(budgetDatabase),tracker=new GestureTracker();let lastSign:{sign:Sign;at:string;result:string}|null=null;
    const gestureView=()=>{const c=conversation.snapshot().state;return watchFor(gestures.settings(),{talking:c==='THINKING'||c==='SPEAKING',approval:guardian.deskApproval(),waiting:c==='WAITING',locked:!!guardian.locked});};
    // Not in the first two minutes: the voice, brain and speech models are loading then, and the camera checker
    // (Python with OpenCV) would compete with them for the CPU.
    const launchedAt=Date.now();
    gestureWatching=()=>models.hands&&Date.now()-launchedAt>120000&&gestureView().watching;
    const gestureSnapshot=()=>{const v=gestureView();return {settings:gestures.settings(),available:models.hands,watching:gestureWatching(),why:models.hands?v.why:null,last:lastSign};};
    const onSign=async(sign:Sign,frame:Buffer)=>{
      const s=gestures.settings();let result='ignored';
      if(sign==='stop'&&s.pause)result=conversation.gesture('stop')?'stopped her':'ignored';
      else if(sign==='wave'&&s.wave)result=conversation.gesture('wave')?'woke her':'ignored';
      else if((sign==='yes'||sign==='no')&&s.approve&&guardian.deskApproval()){
        // The same frame has to show your live face, or the sign is ignored.
        const seen=models.face?guardian.seen(await guardWorker.face(frame)):{who:'unchecked' as const};
        result=guardian.gesture(sign==='yes',seen.who);
      }
      lastSign={sign,at:new Date().toISOString(),result};if(result!=='ignored')guardian.log('gesture',`${({stop:'Palm',wave:'Wave',yes:'Thumbs up',no:'Thumbs down'})[sign]}: ${result}`);
      runtime?.publish();
    };
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith('file://') });
    });
    const worker = new PythonWorker(join(root, 'workers', 'health', 'worker.py'), () => runtime?.publish());
    mark('before runtime');
    runtime = new Runtime(join(dataRoot, 'database', 'harmony.sqlite'), worker, new ConfigStore(join(dataRoot, 'config', 'settings.json')), speech, output, reasoning,ownerLifecycle,allowance,local,conversation);
    runtime.boot();mark('runtime booted');
    runtime.reminders={snapshot:()=>reminderStore.status()};
    runtime.memory={snapshot:()=>{const r=recall.status();return {...memoryStore.status(),recall:{...r,keepDays:EPISODE_DAYS}};}};
    runtime.google={snapshot:()=>google.snapshot()};
    runtime.projects={snapshot:()=>projectStore.status()};
    runtime.desktop={snapshot:()=>desktop!.status(),stop:()=>desktop!.stop()};
    runtime.modes={snapshot:()=>({...modes.status(),ideas:ideas.list(60).map(({id,at,text,stage,projectId})=>({id,at,text,stage,project:projectId?projectStore.get(projectId)?.name??null:null}))})};
    // Every proactive event goes through the interruption engine (Phase 30): it decides ignore, keep, show or speak.
    // Speech happens only while HARMONY is running; after STOP things are shown, not said.
    const running=()=>{const state=runtime?.snapshot().system;return !!state&&!['STOPPED','ERROR','OFF','BOOTING'].includes(state);};
    const interruptions=new InterruptionEngine(()=>({mode:modes.status().mode,busy:['THINKING','SPEAKING'].includes(conversation.snapshot().state),quietHours:inQuietHours(new Date()),now:Date.now(),proactivity:personality.status().traits.proactivity}),
      text=>{if(running())void conversation.announce(text);},()=>runtime?.publish());
    runtime.notices={snapshot:()=>interruptions.notices()};
    const calendarWatch=new CalendarWatcher((range,signal)=>google.events(range,signal),()=>google.has('calendar'),interruptions);calendarWatch.start();watch.start();
    const brief=new MorningBrief(budgetDatabase,worldFeeds,watch,text=>interruptions.raise({source:'system',key:`brief:${new Date().toDateString()}`,text:(()=>{try{spiral.importInbox();const l=[spiral.morningLine(),jobScout.morningLine()].filter(Boolean).join(' ');return l?`${text} ${l}`:text;}catch{return text;}})(),long:true,importance:.75,urgency:.5,confidence:1,relevance:.9,expiresAt:Date.now()+3*3600000}),()=>powerMonitor.getSystemIdleTime());brief.extra=async()=>{const r=await refreshInbox().catch(()=>null),c=dailyBrief.today();return [r?briefText(r):null,c?`Here's your daily brief. ${c.spoken}`:null].filter(Boolean).join(' ')||null;};brief.start();
    // Daily self-check while you're away: database, backup, disk, pinned models, God's Eye, security. Notice only if needed.
    selfCheck=new SelfCheck({root,dataRoot,db:budgetDatabase,backups,offsite:()=>offsiteState,guard:()=>guardian.status(),trust:()=>nodeTrust},()=>powerMonitor.getSystemIdleTime(),
     r=>interruptions.raise({source:'system',key:`selfcheck:${r.at.slice(0,10)}`,text:r.summary,importance:r.problems?.8:.55,urgency:.4,confidence:1,relevance:.9,expiresAt:Date.now()+12*3600000}));
    selfCheck.start();
    sayConnectivity=text=>interruptions.raise({source:'system',key:`net:${Date.now()}`,text,importance:.7,urgency:.6,confidence:1,relevance:1,expiresAt:Date.now()+3600000});
    // Step 20: monthly security drills, on a sandbox. A drill that doesn't hold is an alert.
    const drills=new SecurityDrills(budgetDatabase,()=>powerMonitor.getSystemIdleTime(),r=>{
      guardian.log('drill',`${r.passed} of ${r.results.length} drills held`);
      if(r.failed)interruptions.raise({source:'system',key:`drills:${r.at.slice(0,10)}`,text:drillSummary(r),importance:.9,urgency:.6,confidence:1,relevance:1,expiresAt:Date.now()+24*3600000});
      runtime?.publish();});
    drillsRef=drills;const drillTimer=setInterval(()=>drills.tick(),60*60000);drillTimer.unref?.();
    // Step 17: the end-of-day work summary, once, after 4:30 PM on days something was logged. Just for Alec.
    const workTimer=setInterval(()=>{try{
      const d=new Date(),day=d.toDateString();if(d.getHours()*60+d.getMinutes()<16*60+30)return;
      const told=(budgetDatabase?.prepare("SELECT value FROM memory_settings WHERE key='work_summary_day'").get() as {value?:string}|undefined)?.value;if(told===day)return;
      const s=work.summary();if(s.startsWith('Nothing logged today'))return;
      budgetDatabase?.prepare("INSERT INTO memory_settings (key,value) VALUES ('work_summary_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(day);
      interruptions.raise({source:'system',key:`work:${day}`,text:`End of day. ${s}`,importance:.7,urgency:.4,confidence:1,relevance:1,expiresAt:Date.now()+4*3600000});
    }catch{}},10*60000);workTimer.unref?.();
    raiseNotice=(key,text,importance)=>interruptions.raise({source:'system',key,text,importance,urgency:.4,confidence:1,relevance:.9,expiresAt:Date.now()+12*3600000});
    let toldUpdate:string|null=null;
    const checkUpdate=()=>{try{const u=updater.status();if(u.available&&u.head&&u.head!==toldUpdate){toldUpdate=u.head;raiseNotice(`update:${u.head}`,updateText(u),.6);runtime?.publish();}}catch{}};
    setTimeout(checkUpdate,60000).unref?.();const updateTimer=setInterval(checkUpdate,10*60000);updateTimer.unref?.();
    const spiralTimer=setInterval(()=>{try{const n=spiral.importInbox();const h=new Date().getHours();
      if(n&&h>=7&&h<23)interruptions.raise({source:'system',key:`spiral:${Date.now()}`,text:`Spiral Time finished ${n} job${n>1?'s':''}. Say "read me the research" to hear ${n>1?'them':'it'}.`,importance:.6,urgency:.3,confidence:1,relevance:.9,expiresAt:Date.now()+6*3600000});}catch{}},5*60000);spiralTimer.unref?.();
    const screenWatch=new ScreenWatcher(desktop!,interruptions,()=>!running());screenWatch.start();
    // Background research missions: the brain is used only when you're not talking to HARMONY.
    const missionChat=new LocalChatClient();
    const missionRunner=new MissionRunner(missions,{
      online:()=>connectivity.online,
      lookup:(id,value,signal)=>actions.agentLookup(id,value,signal),
      think:async(prompt,max,signal)=>{const endpoint=await localServer.ensure(signal);let text='';
        try{for await(const e of missionChat.stream(endpoint,{text:prompt,maxOutputTokens:max,signal,history:[]})){if(e.type==='text')text+=e.text;else break;}}finally{localServer.scheduleIdle();}
        return text;},
      idle:()=>running()&&['OFF','WAITING','ERROR'].includes(conversation.snapshot().state)&&!['STARTING','STREAMING'].includes(local.snapshot().state),
      announce:text=>interruptions.raise({source:'system',key:`mission:${text.slice(0,60)}`,text,importance:.7,urgency:.5,confidence:1,relevance:.8,expiresAt:Date.now()+6*3600000}),
      changed:()=>runtime?.publish()});
    missionRunner.start();haltMissions=()=>missionRunner.halt();
    runtime.missions={snapshot:()=>missions.list(10).map(m=>missions.summary(m))};
    runtime.skills={snapshot:()=>skills.list()};
    runtime.media={snapshot:()=>mediaItems(budgetDatabase!)};
    runtime.backups={snapshot:()=>({list:backups.list(),restorePending:backups.restorePending,restored})};
    runtime.personality={snapshot:()=>({...personality.status(),flourish,bootLine})};
    // Smart arrival: only speaks when there's something worth saying after you've been away 30+ minutes.
    const arrival=new ArrivalTracker(away=>{void (async()=>{
      const since=new Date(Date.now()-away*60000).toISOString();
      const missed=budgetDatabase!.prepare("SELECT text FROM reminders WHERE state='FIRED' AND fired_at>=? ORDER BY fired_at").all(since).map(r=>String(r.text));
      const ready=missions.list(10).filter(m=>m.status==='DONE'&&!m.heard&&m.updatedAt>=since).map(m=>m.objective.slice(0,60));
      let nextEvent:{title:string;minutes:number}|null=null;
      if(google.has('calendar'))try{const c=new AbortController(),t=setTimeout(()=>c.abort(),8000);const ev=(await google.events({start:new Date(),end:new Date(Date.now()+45*60000)},c.signal).finally(()=>clearTimeout(t))).find(e=>!e.allDay);
        if(ev)nextEvent={title:ev.title,minutes:Math.round((ev.start.getTime()-Date.now())/60000)};}catch{}
      const text=arrivalSummary({awayMinutes:away,missedReminders:missed,readyResearch:ready,nextEvent,newNotices:interruptions.notices().length});
      if(text)interruptions.raise({source:'system',key:`arrival:${Math.floor(Date.now()/600000)}`,text,importance:.7,urgency:.5,confidence:1,relevance:.9,expiresAt:Date.now()+15*60000});
    })();});
    powerMonitor.on('lock-screen',()=>{arrival.locked();guardian.windowsLocked();});powerMonitor.on('unlock-screen',()=>arrival.unlocked());
    const idleTimer=setInterval(()=>{try{arrival.idle(powerMonitor.getSystemIdleTime());}catch{}},60000);idleTimer.unref?.();
    const guardTimer=setInterval(()=>{try{guardian.tick(powerMonitor.getSystemIdleTime());}catch{}},30000);guardTimer.unref?.();
    // Phone companion: off unless turned on in Settings; home network only; paired phones only.
    // Each phone's secret is sealed with Windows encryption so HARMONY can check its signed approvals.
    const companionAuth=new CompanionAuth(budgetDatabase,Date.now,process.platform==='win32'&&safeStorage.isEncryptionAvailable()?
      {seal:t=>safeStorage.encryptString(t).toString('base64'),open:v=>safeStorage.decryptString(Buffer.from(v,'base64'))}:null);
    const phone=new CompanionServer(budgetDatabase,companionAuth,{
      state:()=>{const l=runtime!.snapshot().localReasoning;return {local:{state:l?.state??'IDLE',text:(l?.text??'').slice(-4000),error:l?.error??null},notices:interruptions.notices().slice(0,5).map(({text,at})=>({text,at})),
        reminders:reminderStore.status().upcoming.slice(0,5).map(({text,dueAt})=>({text,dueAt})),missions:missions.list(5).filter(m=>m.status!=='CANCELLED').map(m=>({objective:m.objective,stage:m.stage})),
        project:projectStore.active()?.name??null,mode:modes.status().mode,
        guard:{locked:guardian.locked?{reason:guardian.locked.reason,strict:guardian.locked.strict,at:new Date(guardian.locked.at).toISOString()}:null,alerts:guardAlerts}};},
      ask:text=>{try{runtime!.clearLocal();}catch{}guardian.markPhoneAsk();runtime!.askLocal(text);},
      guard:{pending:()=>guardian.pending('phone'),answer:(id,a)=>guardian.answer(id,a,'phone'),lock:()=>guardian.lock('Locked from your phone',true),unlock:()=>guardian.unlock('your phone')},
      stop:async()=>{void memoryEmbedder?.stop();void desktop?.stop();haltMissions();speech.dropStandby();await runtime!.stop();},
      changed:()=>runtime?.publish()});
    phone.start();runtime.companion={snapshot:()=>phone.status()};
    watchers=[calendarWatch,screenWatch,missionRunner,{stop:()=>clearInterval(idleTimer)},{stop:()=>clearInterval(guardTimer)},{stop:()=>clearInterval(modelTimer)},{stop:()=>{void phone.stop();}},{stop:()=>{void guardWorker.stop();}},{stop:()=>{void godsEyeWindow.close();void godsEye.stop();}},{stop:()=>watch.stop()},{stop:()=>brief.stop()}];
    runtime.guard={snapshot:()=>guardian.status()};runtime.update={snapshot:()=>cached('update',10000,()=>updater.status())};runtime.work={snapshot:()=>work.snapshot()};runtime.wake={snapshot:()=>wake.stats()};runtime.drills={snapshot:()=>drillsRef?.last??null};runtime.connectivity={snapshot:()=>connectivity.status()};runtime.speed={snapshot:()=>cached('speed',15000,()=>speedBoard.board())};runtime.jobs={snapshot:()=>cached('jobs',3000,()=>jobScout.view())};runtime.gestures={snapshot:gestureSnapshot};runtime.network={snapshot:()=>cached('network',3000,()=>({...network.view(),on:networkOn(),reconnect:wifi.view(reconnectOn())}))};runtime.routines={snapshot:()=>cached('routines',3000,()=>routines.list().map(r=>({...r,plain:describeSteps(r.steps)})))};
    conversation.onTimed=(t,k)=>{try{speedBoard.record(t,k);}catch{}};conversation.onStartup=ms=>{try{speedBoard.startup(ms);}catch{}
      // How long "Talk to HARMONY" took, by stage, kept in .runtime/talk-start.json (the last 20 starts).
      void (async()=>{try{const {mkdir,readFile,writeFile}=await import('node:fs/promises');const f=join(root,'.runtime','talk-start.json');await mkdir(join(root,'.runtime'),{recursive:true});
        let list:unknown[]=[];try{list=JSON.parse(await readFile(f,'utf8'));}catch{}
        list=[...(Array.isArray(list)?list:[]),{at:new Date().toISOString(),...conversation.snapshot().startup,totalMs:ms}].slice(-20);await writeFile(f,JSON.stringify(list,null,1));}catch{}})();};
    // Keep the brain and the voice loaded while HARMONY is open and idle, so talking starts fast. Not after STOP.
    // Weekly self-improvement (docs/SELF-IMPROVE.md): her own speed numbers, saved hourly for the weekly Claude review.
    const saveSpeed=()=>{void (async()=>{try{const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(join(root,'.runtime'),{recursive:true});
      await writeFile(join(root,'.runtime','speed.json'),JSON.stringify({at:new Date().toISOString(),board:speedBoard.board(),selfCheck:selfCheck?.last?.summary??null},null,1));}catch{}})();};
    const speedFileTimer=setInterval(saveSpeed,60*60000);speedFileTimer.unref?.();setTimeout(saveSpeed,10*60000).unref?.();
    const prewarm=()=>{try{if(runtime?.snapshot().system==='PASSIVE'&&conversation.snapshot().state==='OFF')conversation.prewarm();}catch{}};
    // Straight away (the speech, voice and brain workers start loading while the window opens; measured: launch to
    // fully ready ~12 s, of which the first 1.5 s used to be waiting), then every 5 s to reload anything unloaded.
    // (Tried at 0.25, 1 and 2 s in case the system isn't settled yet; prewarm does nothing when it's already loading.)
    for(const ms of [250,1000,2000])setTimeout(prewarm,ms).unref?.();const prewarmTimer=setInterval(prewarm,5000);prewarmTimer.unref?.();runtime.inbox={snapshot:()=>inboxState?{...inboxState,drafts:Object.fromEntries(drafts)}:null};
    runtime.godsEye={snapshot:()=>({...godsEye.status(),lite:godsEyeWindow.lite(),watching:watch.list().map(z=>({id:z.id,name:z.name,radiusKm:z.radiusKm}))})};
    reminderScheduler=new ReminderScheduler(reminderStore,due=>{
     for(const r of due){
      const body=r.kind==='timer'?`Time's up. Your ${r.text} is done.`:`Reminder: ${r.text}.`;
      try{if(Notification.isSupported())new Notification({title:'HARMONY',body,silent:false}).show();}catch{}
      try{if(window&&!window.isDestroyed()&&!window.isFocused())window.flashFrame(true);}catch{}
      // Fresh for 15 minutes; after a long sleep a reminder is shown in the tray but not said.
      interruptions.raise({source:r.kind==='timer'?'timer':'reminder',key:`reminder:${r.id}`,text:body,importance:1,urgency:1,confidence:1,relevance:1,expiresAt:new Date(r.dueAt).getTime()+15*60000});
     }
     runtime?.publish();
    });
    reminderScheduler.start();
    const documentPath = join(root, 'dist', 'renderer', 'index.html');
    const documentUrl = pathToFileURL(documentPath).href;
    const armed=()=>Date.now()<microphoneUntil && speech.snapshot().state==='READY';
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const kinds='mediaTypes' in details ? details.mediaTypes ?? [] : [];
      const own=contents.id===window?.webContents.id&&details.isMainFrame&&details.requestingUrl===documentUrl;
      // The camera only for a moment the guardian asked for (or face setup), and the microphone for voice setup.
      const granted=permission==='media'&&(audioPermission(own,true,true,armed()||Date.now()<guardMicUntil,kinds)||(own&&(Date.now()<cameraUntil||gestureWatching())&&kinds.length===1&&kinds[0]==='video'));
      callback(granted);
    });
    session.defaultSession.setPermissionCheckHandler((contents,permission,_origin,details)=>{
      if(permission!=='media')return false;const own=contents?.id===window?.webContents.id&&details.isMainFrame&&details.requestingUrl===documentUrl;
      return audioPermission(own,true,true,armed()||Date.now()<guardMicUntil,[details.mediaType??'unknown'])||(own&&(Date.now()<cameraUntil||gestureWatching())&&details.mediaType==='video');
    });
    mark('services created');
    window = new BrowserWindow({
      width: 1360, height: 900, minWidth: 820, minHeight: 680,
      title: 'HARMONY', backgroundColor: '#0b0a10', show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(root, 'dist', 'electron', 'preload.cjs'),
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false, webviewTag: false
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const trustedWindow = (event: Electron.IpcMainInvokeEvent) => [window, companion].some(candidate =>
      candidate && !candidate.isDestroyed() && trustedSender(event.sender.id, candidate.webContents.id,
        event.senderFrame === candidate.webContents.mainFrame, event.senderFrame?.url ?? '',
        candidate === companion ? documentUrl + '#companion' : documentUrl))
      || (!!orb && !orb.isDestroyed() && trustedSender(event.sender.id, orb.webContents.id, event.senderFrame === orb.webContents.mainFrame, event.senderFrame?.url ?? '', documentUrl + '#orb'));
    const showChamber = () => { window?.show(); window?.restore(); window?.focus(); companion?.close(); };
    const floatDesktop = async () => {
      if (companion && !companion.isDestroyed()) { companion.show(); companion.focus(); if(lastSnapshotRef.value)companion.webContents.send('harmony:state',lastSnapshotRef.value); window?.hide(); return; }
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      const floating = new BrowserWindow({ width: 330, height: 390, x: area.x + Math.max(0, area.width - 354), y: area.y + Math.max(0, area.height - 414),
        title: 'HARMONY companion', transparent: true, backgroundColor: '#00000000', frame: false,
        resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, alwaysOnTop: true, show: false,
        webPreferences: { preload: join(root, 'dist', 'electron', 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
          sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false }
      });
      companion = floating;
      floating.on('page-title-updated', event => event.preventDefault());
      floating.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      floating.webContents.on('will-navigate', event => event.preventDefault());
      floating.webContents.on('render-process-gone', () => { void runtime?.stop().catch(()=>{}); floating.close(); });
      floating.on('closed', () => { if (companion === floating) companion = null; if (!closing) window?.show(); refreshOrb(); });
      try { await floating.loadFile(documentPath, { hash: 'companion' }); floating.show(); window?.hide(); refreshOrb(); }
      catch { floating.destroy(); window?.show(); throw new Error('Companion could not open'); }
    };
    // Step 14: the mini orb on the Dell (or other second) screen. Shown when the chamber isn't on that screen and the
    // floating companion isn't open; it never takes focus.
    const orbSettings=():OrbSettings=>{try{return readOrbSettings((budgetDatabase?.prepare("SELECT value FROM memory_settings WHERE key='orb'").get() as {value?:string}|undefined)?.value);}catch{return readOrbSettings(null);}};
    const displayList=():DisplayInfo[]=>{const primary=screen.getPrimaryDisplay().id;return screen.getAllDisplays().map(d=>({id:d.id,label:d.label||`Screen ${d.id}`,primary:d.id===primary,workArea:d.workArea}));};
    let orbPlacing=false;
    // The latest status, for windows that come back into view (filled in where updates are sent, below).
    const lastSnapshotRef:{value:Snapshot|null;lite:(x:Snapshot)=>unknown}={value:null,lite:x=>x};
    const placeOrb=async()=>{
      if(orbPlacing||closing)return;orbPlacing=true;
      try{
        const s=orbSettings(),d=pickOrbDisplay(displayList(),s);
        const chamberThere=!!d&&!!window&&!window.isDestroyed()&&window.isVisible()&&!window.isMinimized()&&screen.getDisplayMatching(window.getBounds()).id===d.id;
        if(!d||chamberThere||(companion&&!companion.isDestroyed())){if(orb&&!orb.isDestroyed())orb.hide();return;}
        if(!orb||orb.isDestroyed()){
          const w=new BrowserWindow({...orbBounds(d.workArea,s.corner),title:'HARMONY orb',transparent:true,backgroundColor:'#00000000',frame:false,resizable:false,movable:false,
            minimizable:false,maximizable:false,fullscreenable:false,hasShadow:false,alwaysOnTop:true,skipTaskbar:true,focusable:false,show:false,
            webPreferences:{preload:join(root,'dist','electron','preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}});
          w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
          w.on('closed',()=>{if(orb===w)orb=null;});orb=w;
          await w.loadFile(documentPath,{hash:'orb'});
        }
        orb.setBounds(orbBounds(d.workArea,s.corner));const wasHidden=!orb.isVisible();orb.showInactive();if(wasHidden&&lastSnapshotRef.value)orb.webContents.send('harmony:state',lastSnapshotRef.lite(lastSnapshotRef.value));
      }catch{try{orb?.destroy();}catch{}orb=null;}finally{orbPlacing=false;}
    };
    const refreshOrb=()=>{setTimeout(()=>{void placeOrb();},150);};
    // Floating HARMONY moves on her own (core/drift.ts): out of the way of the cursor and the window you're using, nearer
    // while you talk to her, hidden for full-screen video and games. Dragging her pauses it for 20 seconds, then she carries on from the screen you put her on (any of up to four or more).
    let gliding=false,driftLast:{x:number;y:number}|null=null,driftPausedUntil=0,driftHidden=false,driftBusy=false;const driftWatch=new WeakSet<BrowserWindow>();
    const driftTick=async()=>{
      const w=companion;if(driftBusy||gliding||!w||w.isDestroyed()||!w.isVisible()&&!driftHidden||Date.now()<driftPausedUntil||!orbSettings().drift)return;
      driftBusy=true;
      try{
        if(!driftWatch.has(w)){driftWatch.add(w);w.on('will-move',()=>{if(!gliding)driftPausedUntil=Date.now()+20000;});w.on('moved',()=>{const b=w.getBounds();if(!gliding&&!(driftLast&&Math.abs(b.x-driftLast.x)<3&&Math.abs(b.y-driftLast.y)<3))driftPausedUntil=Date.now()+20000;});}
        const current=w.getBounds(),cursor=screen.getCursorScreenPoint(),screens=screen.getAllDisplays().slice(0,8).map(x=>({id:x.id,area:x.workArea,display:x.bounds}));
        let focused:{x:number;y:number;width:number;height:number}|null=null;
        try{const f=desktop?.available?await desktop.foreground():null;if(f)focused=process.platform==='win32'?screen.screenToDipRect(null,f):f;}catch{}
        const c=conversation.snapshot().state,mode:DriftMode=['LISTENING','THINKING','SPEAKING'].includes(c)?'talking':powerMonitor.getSystemIdleTime()<5?'busy':'idle';
        const spot=planDrift(screens,{size:{width:current.width,height:current.height},current,cursor,focused,mode});
        if(spot==='hide'){if(!driftHidden){driftHidden=true;w.setOpacity(0);w.setIgnoreMouseEvents(true);}return;}
        if(driftHidden){driftHidden=false;w.setOpacity(1);w.setIgnoreMouseEvents(false);}
        if(!spot)return;
        gliding=true;
        for(const p of glide(current,spot)){if(w.isDestroyed())break;driftLast=p;w.setPosition(p.x,p.y);await new Promise(r=>setTimeout(r,16));}
      }catch{}finally{gliding=false;driftBusy=false;}
    };
    const driftTimer=setInterval(()=>{void driftTick();},1500);driftTimer.unref?.();
    for(const e of ['display-added','display-removed','display-metrics-changed'] as const)screen.on(e as 'display-added',refreshOrb);
    screen.on('display-removed', () => { if (companion) { const area = screen.getPrimaryDisplay().workArea; companion.setPosition(area.x + 24, area.y + 24); } });
    const operations = {
      floatDesktop,
      showChamber,
      snapshot: () => runtime!.snapshot(),
      check: () => runtime!.check(),
      stop: () => { revokeFiles();microphoneUntil=0;void memoryEmbedder?.stop();void desktop?.stop();haltMissions(); return runtime!.stop(); },
      resume: () => runtime!.resume()
    };
    for (const [name, operation] of Object.entries(operations)) {
      ipcMain.handle(`harmony:${name}`, (event, ...args: unknown[]) => {
        if (!trustedWindow(event)) throw new Error('Untrusted sender');
        validateNoArguments(args);
        return operation();
      });
    }
    const chamberSender=(event:Electron.IpcMainInvokeEvent)=>!!window&&trustedSender(event.sender.id,window.webContents.id,event.senderFrame===window.webContents.mainFrame,event.senderFrame?.url??'',documentUrl);
    ipcMain.handle('harmony:home',(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as {op?:unknown;home?:unknown};
      if(v.op==='get')return readProfile(root).home??null;
      if(v.op==='set'&&v.home&&typeof v.home==='object')return writeHome(root,v.home as import('../../../core/profile.ts').OwnerHome);
      throw new Error('Invalid request');
    });
    ipcMain.handle('harmony:file-root',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted sender');validateNoArguments(args);return fileRoot;});
    ipcMain.handle('harmony:forget-file-root',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted sender');validateNoArguments(args);revokeFiles();});
    ipcMain.handle('harmony:choose-file-root',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||choosingFolder||runtime!.snapshot().system!=='PASSIVE')throw new Error('Folder selection unavailable');validateNoArguments(args);
      choosingFolder=true;const generation=fileGeneration;
      try{
        const chosen=await dialog.showOpenDialog(window!,{title:'Choose a folder HARMONY may read during this session',properties:['openDirectory']});
        if(chosen.canceled)return fileRoot;
        if(generation!==fileGeneration||runtime!.snapshot().system!=='PASSIVE')throw new Error('Folder selection cancelled');
        revokeFiles();const grantGeneration=fileGeneration;
        const canonical=await files.addRoot('workspace',chosen.filePaths[0]);
        if(grantGeneration!==fileGeneration||runtime!.snapshot().system!=='PASSIVE'){revokeFiles();throw new Error('Folder selection cancelled');}
        fileRoot=canonical;return fileRoot;
      }finally{choosingFolder=false;}
    });
    ipcMain.handle('harmony:preview-file',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string'||!fileRoot)throw new Error('Choose a folder first');
      const generation=fileGeneration,result=await runtime!.previewFile(files,args[0]);
      if(generation!==fileGeneration)throw new Error('File access revoked');return result;
    });
    ipcMain.handle('harmony:inspect-computer',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted sender');validateNoArguments(args);return runtime!.inspectComputer();});
    ipcMain.handle('harmony:allowance-review',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1)throw new Error('Untrusted request');return runtime!.reviewAllowance(args[0]);});
    ipcMain.handle('harmony:allowance-approve',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1)throw new Error('Untrusted request');return runtime!.approveAllowance(args[0]);});
    ipcMain.handle('harmony:allowance-cancel',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted request');validateNoArguments(args);return runtime!.cancelAllowance();});
    ipcMain.handle('harmony:owner-status',async(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted sender');validateNoArguments(args);return {...await owner.status(),available:ownerAvailable};});
    ipcMain.handle('harmony:owner-enroll',(event,...args:unknown[])=>{if(!chamberSender(event)||!ownerAvailable)throw new Error('Owner enrollment unavailable');validateNoArguments(args);return runtime!.runOwnerAction(signal=>owner.enroll(signal));});
    ipcMain.handle('harmony:reasoning-review',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length<1||args.length>2||reasoningSettingsBusy)throw new Error('Untrusted request');return runtime!.reviewReasoning(args[0],args[1]);});
    ipcMain.handle('harmony:reasoning-approve',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1)throw new Error('Untrusted request');return runtime!.approveReasoning(args[0]);});
    ipcMain.handle('harmony:reasoning-cancel',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted request');validateNoArguments(args);return runtime!.cancelReasoning();});
    ipcMain.handle('harmony:local-ask',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1)throw new Error('Untrusted request');runtime!.askLocal(args[0]);});
    ipcMain.handle('harmony:local-cancel',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted request');validateNoArguments(args);return runtime!.cancelLocal();});
    ipcMain.handle('harmony:reminder-cancel',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string')throw new Error('Untrusted request');return actions.cancelById(args[0]);});
    ipcMain.handle('harmony:reminder-dismiss',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string')throw new Error('Untrusted request');const ok=reminderStore.acknowledge(args[0]);runtime?.publish();return ok;});
    // Opens a web source in the default browser, but only one HARMONY itself is currently showing as a source.
    ipcMain.handle('harmony:open-source',(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string'||args[0].length>2000)throw new Error('Untrusted request');
      const snap=runtime?.snapshot() as {voiceConversation?:{sources?:{url:string}[]};localReasoning?:{sources?:{url:string}[]}}|undefined;
      const known=[...(snap?.voiceConversation?.sources??[]),...(snap?.localReasoning?.sources??[]),...((snap as {media?:{sources:{url:string}[]}[]}|undefined)?.media??[]).flatMap(m=>m.sources)].some(s=>s.url===args[0]);
      const setupLink=args[0]==='https://console.cloud.google.com/projectcreate';
      if(!(known||setupLink)||!/^https?:\/\//.test(args[0]))return false;
      void shell.openExternal(args[0]);return true;
    });
    // Google (read only): import Alec's own Desktop-app client file, then sign in through the browser.
    const googleReply=(work:()=>Promise<unknown>)=>work().then(()=>{runtime?.publish();return {ok:true,message:null};}).catch(e=>{runtime?.publish();return {ok:false,message:e instanceof GoogleError?e.message:'That did not work. Try again.'};});
    ipcMain.handle('harmony:google-import',async event=>{
      if(!chamberSender(event))throw new Error('Untrusted request');
      const chosen=await dialog.showOpenDialog(window!,{title:'Choose your Google OAuth client file (Desktop app)',filters:[{name:'Google client file',extensions:['json']}],properties:['openFile']});
      if(chosen.canceled||!chosen.filePaths[0])return {ok:false,message:null};
      return googleReply(async()=>{const text=readFileSync(chosen.filePaths[0],'utf8');if(text.length>20000)throw new GoogleError('That file is too large to be a client file.');await google.importClient(text);});
    });
    ipcMain.handle('harmony:google-connect',(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!Array.isArray(args[0])||!args[0].every(c=>c==='calendar'||c==='gmail'))throw new Error('Untrusted request');
      return googleReply(()=>google.connect(args[0] as GoogleCapability[],url=>{if(!url.startsWith('https://accounts.google.com/'))throw new Error('Unexpected URL');return shell.openExternal(url);}));
    });
    ipcMain.handle('harmony:google-disconnect',(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||(args[0]!=='disconnect'&&args[0]!=='forget'))throw new Error('Untrusted request');
      return googleReply(()=>args[0]==='forget'?google.forget():google.disconnect());
    });
    // Projects panel: explicit clicks. Writes are small and local; removing a project needs a typed confirmation word.
    const projectCall=(work:()=>unknown)=>{try{const r=work();runtime?.publish();return {ok:true,message:null,value:r??null};}catch(e){return {ok:false,message:e instanceof ReminderInputError?e.message:'That did not work.'};}};
    ipcMain.handle('harmony:project',(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const a=args[0] as Record<string,unknown>,str=(k:string,max:number)=>typeof a[k]==='string'&&(a[k] as string).length<=max?a[k] as string:null;
      switch(a.op){
        case 'switch':{if(a.id!==null&&!str('id',40))throw new Error('Untrusted request');const id=a.id===null?null:str('id',40);return projectCall(()=>projectStore.switchTo(id));}
        case 'create':{const name=str('name',60);if(!name)throw new Error('Untrusted request');return projectCall(()=>projectStore.create(name,str('description',300)??''));}
        case 'note':{const id=str('id',40),kind=str('kind',10),text=str('text',240);if(!id||!kind||!text||!['task','decision','blocker','note'].includes(kind))throw new Error('Untrusted request');return projectCall(()=>projectStore.addNote(id,kind as NoteKind,text));}
        case 'close':case 'reopen':{const id=str('id',40);if(!id)throw new Error('Untrusted request');return projectCall(()=>projectStore.setOpen(id,a.op==='reopen'));}
        case 'remove-note':{const id=str('id',40);if(!id)throw new Error('Untrusted request');return projectCall(()=>projectStore.removeNote(id));}
        case 'update':{const id=str('id',40);if(!id)throw new Error('Untrusted request');
          const world=str('world',20),status=str('status',10);
          return projectCall(()=>projectStore.update(id,{...(str('description',300)!==null?{description:str('description',300)!}:{}),...(str('goals',600)!==null?{goals:str('goals',600)!}:{}),
            ...(world&&WORLDS.includes(world as World)?{world:world as World}:{}),...(status&&['ACTIVE','PAUSED','DONE'].includes(status)?{status:status as 'ACTIVE'}:{})}));}
        case 'remove':{const id=str('id',40);if(!id||a.confirm!=='delete')throw new Error('Untrusted request');return projectCall(()=>projectStore.remove(id));}
        default:throw new Error('Untrusted request');
      }
    });
    ipcMain.handle('harmony:memory-add',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string'||args[0].length>400)throw new Error('Untrusted request');return actions.rememberFromScreen(args[0]);});
    ipcMain.handle('harmony:memory-forget',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string')throw new Error('Untrusted request');return actions.forgetById(args[0]);});
    // Forget everything is deliberately screen-only (two clicks in the Memory panel), never by voice.
    ipcMain.handle('harmony:memory-forget-all',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||args[0]!=='forget everything')throw new Error('Untrusted request');const n=memoryStore.forgetAll();runtime?.publish();return n;});
    ipcMain.handle('harmony:memory-search',async(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string'||args[0].length>200)throw new Error('Untrusted request');
      const hits=await recall.search(args[0],{limit:12,minScore:.15,waitMs:5000});return hits.map(({kind,id,text,at,project,score})=>({kind,id,text,at,project,score}));});
    ipcMain.handle('harmony:memory-pin',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==2||typeof args[0]!=='string'||typeof args[1]!=='boolean')throw new Error('Untrusted request');const ok=memoryStore.pin(args[0],args[1]);runtime?.publish();return ok;});
    // Keeping conversations is the person's choice, changed only by an explicit click; forgetting them is two clicks.
    ipcMain.handle('harmony:memory-episodes',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||typeof args[0]!=='boolean')throw new Error('Untrusted request');recall.setEpisodes(args[0]);runtime?.publish();return args[0];});
    ipcMain.handle('harmony:memory-forget-episodes',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||args[0]!=='forget conversations')throw new Error('Untrusted request');const n=recall.forgetEpisodes();runtime?.publish();return n;});
    // Explicit clicks: change mode, move an idea to another stage, or delete it (two clicks in the panel).
    ipcMain.handle('harmony:notice-dismiss',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string'||args[0].length>40)throw new Error('Untrusted request');return interruptions.dismiss(args[0]);});
    ipcMain.handle('harmony:mission-cancel',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||typeof args[0]!=='string'||!/^[0-9a-f-]{36}$/.test(args[0]))throw new Error('Untrusted request');const ok=missions.cancel(args[0]);runtime?.publish();return ok;});
    ipcMain.handle('harmony:skill',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==2||typeof args[1]!=='boolean'||!SKILLS.some(s=>s.id===args[0]&&!(s.core&&!args[1])))throw new Error('Untrusted request');skills.set(args[0] as string,args[1]);return true;});
    ipcMain.handle('harmony:personality',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as {profile?:unknown;traits?:Record<string,unknown>};if(!PROFILES.includes(v.profile as Profile))throw new Error('Untrusted request');
      const traits=v.traits&&typeof v.traits==='object'?Object.fromEntries(Object.entries(v.traits).filter(([k,x])=>(TRAITS as readonly string[]).includes(k)&&typeof x==='number')):undefined;
      personality.set(v.profile as Profile,traits as never);return true;});
    ipcMain.handle('harmony:backup',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as {op?:unknown;name?:unknown;confirm?:unknown};let ok=false;
      if(v.op==='create'){backups.create(budgetDatabase!);ok=true;}
      else if(v.op==='restore'&&v.confirm==='restore'&&typeof v.name==='string')ok=backups.requestRestore(v.name);
      else if(v.op==='cancel-restore'){backups.cancelRestore();ok=true;}
      else throw new Error('Untrusted request');
      runtime?.publish();return ok;});
    ipcMain.handle('harmony:inbox',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;if(guardian.locked)return {ok:false,message:'Unlock HARMONY first.'};
      if(v.op==='refresh'){const r=await refreshInbox();return {ok:!!r,message:r?null:inboxState?.error??'Google isn\'t connected.'};}
      const id=typeof v.id==='string'&&/^[\w-]{6,64}$/.test(v.id)?v.id:null,m=id?inboxState?.needsYou.concat(inboxState.fyi).find(x=>x.id===id):null;
      if(!m)return {ok:false,message:'That email is no longer in the list. Refresh.'};
      if(v.op==='draft'){
        // Drafted on this PC by the local brain; the email is data in the prompt, and no functions are offered.
        const body=await google.messageText(m.id).catch(()=>m.snippet);
        const endpoint=await localServer.ensure(AbortSignal.timeout(120000));let text='';
        try{for await(const e of new LocalChatClient().stream(endpoint,{text:draftPrompt(m,body,readProfile(root).job?.name??''),maxOutputTokens:260,signal:AbortSignal.timeout(120000),history:[]})){if(e.type==='text')text+=e.text;else break;}}finally{localServer.scheduleIdle();}
        const d:Draft={to:m.fromEmail,subject:replySubject(m.subject),body:cleanDraft(text),threadId:m.threadId};
        if(!d.body)return {ok:false,message:'The local brain didn\'t come up with a draft. Try again.'};
        drafts.set(m.id,d);runtime?.publish();return {ok:true,message:null};
      }
      if(v.op==='edit'&&typeof v.body==='string'){const d=drafts.get(m.id);if(d){drafts.set(m.id,{...d,body:v.body.slice(0,4000)});runtime?.publish();}return {ok:true,message:null};}
      if(v.op==='compose'){const d=drafts.get(m.id);if(!d)return {ok:false,message:'Draft it first.'};void shell.openExternal(composeUrl(d));return {ok:true,message:'Opened in Gmail. Check it and press send yourself.'};}
      if(v.op==='open'){void shell.openExternal(`https://mail.google.com/mail/u/0/#all/${m.id}`);return {ok:true,message:null};}
      throw new Error('Untrusted request');
    });
    ipcMain.handle('harmony:jobs',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;if(guardian.locked)return {ok:false,message:'Unlock HARMONY first.'};
      if(v.op==='profile'&&v.profile&&typeof v.profile==='object'){jobScout.setProfile(v.profile as Record<string,unknown>);(cache.clear(),runtime?.publish());return {ok:true,message:null};}
      if(v.op==='scout'&&typeof v.on==='boolean'){jobScout.want(v.on);(cache.clear(),runtime?.publish());return {ok:true,message:v.on?'Set for the next Spiral Time.':null};}
      if(v.op==='mark'&&typeof v.url==='string'&&['new','saved','applied','hidden'].includes(String(v.status))){const ok=jobScout.mark(v.url,v.status as 'new');(cache.clear(),runtime?.publish());return {ok,message:null};}
      // Only a link that came back as a lead, and only http(s): the result file is untrusted.
      if(v.op==='open'&&typeof v.url==='string'&&/^https?:\/\//.test(v.url)&&jobScout.isLead(v.url)){void shell.openExternal(v.url);return {ok:true,message:null};}
      throw new Error('Untrusted request');
    });
    ipcMain.handle('harmony:gesture',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;
      if(v.op==='settings'){
        // Letting a thumbs up approve things is a security change, so turning it on needs your approval.
        if((v.patch as {approve?:unknown}|null)?.approve===true&&!gestures.settings().approve){try{await guardian.sensitive('Let a thumbs up approve things');}catch{return {watching:gestureWatching()};}}
        gestures.update(v.patch);(cache.clear(),runtime?.publish());return {watching:gestureWatching()};
      }
      if(v.op!=='frame'||typeof v.jpeg!=='string'||v.jpeg.length>400_000)throw new Error('Untrusted request');
      if(!gestureWatching()){tracker.reset();return {watching:false};}
      const frame=Buffer.from(v.jpeg,'base64'),r=await guardWorker.hands(frame);
      const hand=r.hands.slice().sort((a,b)=>b.conf-a.conf)[0]??null;
      const sign=tracker.push(Date.now(),hand,r.aspect);
      if(sign)await onSign(sign,frame).catch(()=>{});
      frame.fill(0);return {watching:gestureWatching(),hand:!!hand};
    });
    ipcMain.handle('harmony:network',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;if(guardian.locked)return false;
      const mac=typeof v.mac==='string'&&/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(v.mac)?v.mac:null;let ok=false;
      if(v.op==='scan'){await scanNetwork(true);ok=true;}
      else if(v.op==='label'&&mac&&(typeof v.label==='string'||v.label===null))ok=network.label(mac,v.label as string|null);
      else if(v.op==='forget'&&mac)ok=network.forget(mac);
      else if(v.op==='on'&&typeof v.on==='boolean'){budgetDatabase!.prepare("INSERT INTO memory_settings (key,value) VALUES ('network_watch_on',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(v.on?'1':'0');ok=true;}
      else if(v.op==='reconnect'&&typeof v.on==='boolean'){putSetting('wifi_reconnect_on',v.on?'1':'0');ok=true;}
      else throw new Error('Untrusted request');
      (cache.clear(),runtime?.publish());return ok;
    });
    // Start with Windows: off unless Alec turns it on. It adds HARMONY to his Windows sign-in items (his user only),
    // started with --background. Turning it off removes the entry.
    ipcMain.handle('harmony:startup',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>,available=process.platform==='win32';
      const loginArgs=[root,'--background'],state=()=>({atLogin:available&&app.getLoginItemSettings({path:process.execPath,args:loginArgs}).openAtLogin,available});
      if(v.op==='get')return state();
      if(v.op==='set'&&typeof v.atLogin==='boolean'&&available){if(guardian.locked)return state();app.setLoginItemSettings({openAtLogin:v.atLogin,path:process.execPath,args:loginArgs});return state();}
      throw new Error('Untrusted request');
    });
    ipcMain.handle('harmony:routines',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>,r=typeof v.id==='string'?routines.get(v.id):null;if(!r||guardian.locked)return false;
      if(v.op==='approve'){
        // Approving lets a spoken phrase run several actions, so it gets the same approval as other security changes.
        try{await guardian.sensitive(`Approve the skill "${r.phrase}": ${describeSteps(r.steps)}`.slice(0,200));}catch{return false;}
        const ok=routines.approve(r.id);if(ok)guardian.log('skill',`Approved taught skill "${r.phrase}"`);(cache.clear(),runtime?.publish());return ok;
      }
      if(v.op==='remove'){const ok=routines.remove(r.id);(cache.clear(),runtime?.publish());return ok;}
      throw new Error('Untrusted request');
    });
    ipcMain.handle('harmony:drills',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||(args[0] as {op?:unknown})?.op!=='run')throw new Error('Untrusted request');
      if(!drillsRef)return null;const r=await drillsRef.run();runtime?.publish();return {passed:r.passed,failed:r.failed};
    });
    ipcMain.handle('harmony:wake',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>,pcm=()=>{if(typeof v.pcm!=='string'||v.pcm.length>16000*2*3*1.4)throw new Error('Too long');const b=Buffer.from(v.pcm,'base64');return new Int16Array(b.buffer,b.byteOffset,Math.floor(b.length/2));};
      try{
        if(v.op==='teach'){await guardian.sensitive('Teach the wake word');const r=await wake.teach(pcm());runtime?.publish();return r;}
        if(v.op==='teach-not'){await guardian.sensitive('Teach the wake word');const ok=await wake.teachNot(pcm());runtime?.publish();return {ok,count:0,reason:ok?null:'That was too quiet to learn from.'};}
        if(v.op==='reset'){await guardian.sensitive('Reset the wake word');await wake.reset();runtime?.publish();return {ok:true,count:0,reason:null};}
      }catch(e){return {ok:false,count:0,reason:e instanceof GuardDenied?e.message:'That did not work.'};}
      throw new Error('Untrusted request');
    });
    ipcMain.handle('harmony:work',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>,id=typeof v.id==='string'&&/^[0-9a-f-]{36}$/.test(v.id)?v.id:null;
      if(guardian.locked)return {ok:false,message:'Unlock HARMONY first.'};
      try{
        if(v.op==='add'&&typeof v.place==='string'&&typeof v.title==='string'){work.add(v.place,v.title);}
        else if(v.op==='done'&&id){const j=work.get(id);if(j)work.done(j.place,j.title,null);}
        else if(v.op==='reopen'&&id)work.reopen(id);
        else if(v.op==='receipt'&&id){
          const pick=await dialog.showOpenDialog(window!,{title:'Attach a receipt',filters:[{name:'Photos and PDFs',extensions:['jpg','jpeg','png','webp','heic','pdf']}],properties:['openFile']});
          if(pick.canceled||!pick.filePaths[0])return {ok:false,message:null};
          const f=pick.filePaths[0],ext=f.split('.').pop()!.toLowerCase(),mime=ext==='pdf'?'application/pdf':ext==='png'?'image/png':ext==='webp'?'image/webp':ext==='heic'?'image/heic':'image/jpeg';
          const {statSync}=await import('node:fs');if(statSync(f).size>10*1024*1024)return {ok:false,message:'Receipts can be up to 10 MB.'};
          work.attach(id,f.split(/[\\/]/).pop()!,mime,readFileSync(f));
        }
        else if(v.op==='open-file'&&typeof v.file==='string'&&/^[0-9a-f-]{36}$/.test(v.file)){
          const r=work.file(v.file);if(!r)return {ok:false,message:'That receipt is gone.'};
          const dir=join(dataRoot,'tmp','receipts');mkdirSync(dir,{recursive:true});
          const ext=r.mime==='application/pdf'?'pdf':r.mime.split('/')[1]==='jpeg'?'jpg':r.mime.split('/')[1];
          const out=join(dir,`${v.file}.${ext}`);writeFileSync(out,r.bytes);void shell.openPath(out);return {ok:true,message:null};
        }
        else throw new Error('Untrusted request');
        runtime?.publish();return {ok:true,message:null};
      }catch(e){return {ok:false,message:e instanceof Error&&e.constructor.name==='WorkInputError'?e.message:'That did not work.'};}
    });
    ipcMain.handle('harmony:offsite',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;
      const reply=async(extra:Record<string,unknown>={})=>{offsiteState=await offsite.status();runtime?.publish();return {status:offsiteState,places:await offsitePlaces(),...extra};};
      try{
        if(v.op==='get')return reply();
        if(v.op==='enable'){
          const allowed=new Set((await offsitePlaces()).map(p=>p.path)),want=(Array.isArray(v.targets)?v.targets:[]).filter((t):t is string=>typeof t==='string'&&allowed.has(t));
          await guardian.sensitive('Turn on off-PC backups');const r=await offsite.enable(want);return reply({recovery:r.recovery});}
        if(v.op==='confirm'&&typeof v.last==='string'){const ok=await offsite.confirm(v.last.slice(0,8));if(ok)void offsiteTick(true);return reply({confirmed:ok});}
        if(v.op==='disable'){await guardian.sensitive('Turn off off-PC backups');await offsite.disable();return reply();}
        if(v.op==='now'){await offsiteTick(true);return reply();}
        if(v.op==='restore'){
          await guardian.sensitive('Restore from an off-PC backup');
          const pick=await dialog.showOpenDialog(window!,{title:'Choose a HARMONY off-PC backup',filters:[{name:'HARMONY backup',extensions:['hbk']}],properties:['openFile']});
          if(pick.canceled||!pick.filePaths[0])return reply({message:null});
          const payload=await offsite.restore(pick.filePaths[0],typeof v.recovery==='string'&&v.recovery.trim()?v.recovery:null);
          const db=payload.files['harmony.sqlite'];if(!db||!db.subarray(0,16).toString('latin1').startsWith('SQLite format 3'))throw new Error('That backup has no database in it.');
          mkdirSync(join(dataRoot,'backups'),{recursive:true});writeFileSync(join(dataRoot,'backups','restore-pending.sqlite'),db);
          guardian.log('backup',`Off-PC backup from ${payload.at.slice(0,16).replace('T',' ')} will be restored on the next start`);
          return reply({message:`The backup from ${new Date(payload.at).toLocaleString()} will be restored the next time HARMONY starts.`});
        }
      }catch(e){return reply({error:e instanceof WrongKey||e instanceof GuardDenied?e.message:e instanceof Error&&e.message.length<120?e.message:'That did not work.'});}
      throw new Error('Untrusted request');
    });
    ipcMain.handle('harmony:companion',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as {op?:unknown;on?:unknown;id?:unknown};
      if(v.op==='enable'&&typeof v.on==='boolean')phone.setEnabled(v.on);
      else if(v.op==='code'&&phone.enabled)companionAuth.newCode();
      else if(v.op==='forget'&&typeof v.id==='string'&&/^[0-9a-f]{16}$/.test(v.id))companionAuth.forget(v.id);
      else throw new Error('Untrusted request');
      runtime?.publish();return true;});
    // The 3D ornament (one fixed, built file). Renderers can't fetch file:// URLs, so the main process reads it.
    // Security settings, enrollment and approvals. Prints are computed by the guard worker and never reach this window.
    ipcMain.handle('harmony:guard',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;
      const fail=(e:unknown)=>{throw new Error(e instanceof GuardDenied?e.message:'That did not work.');};
      try{
        switch(v.op){
          case 'settings':await guardian.sensitive('Change security settings');return guardian.update(v.patch);
          case 'arm-mic':guardMicUntil=Date.now()+10000;return true;
          case 'arm-camera':if(!guardian.settings().face&&v.purpose!=='enroll')return false;cameraUntil=Date.now()+8000;return true;
          case 'voice':{
            if(typeof v.pcm!=='string'||v.pcm.length>16000*2*12*1.4)return {ok:false,reason:'Too long'};
            await guardian.sensitive('Teach HARMONY a voice');
            const r=await guardWorker.voice(Buffer.from(v.pcm,'base64'));
            if(!r.embedding)return {ok:false,reason:r.reason??'I couldn\'t hear enough. Try again a little louder.'};
            return {ok:true,...guardian.enrollVoice(r.embedding)};
          }
          case 'face':{
            if(typeof v.jpeg!=='string'||v.jpeg.length>2_000_000)return {ok:false,reason:'Too large'};
            if(v.purpose==='enroll')await guardian.sensitive('Teach HARMONY a face');
            const r=await guardWorker.face(Buffer.from(v.jpeg,'base64'));
            if(v.purpose==='enroll'){const e=guardian.enrollFace(r);return {ok:!e.problem,count:e.count,ready:e.ready,reason:e.problem};}
            const seen=guardian.seen(r);return {ok:true,who:seen.who};
          }
          case 'duress':await guardian.sensitive(v.phrase===null?'Remove the duress phrase':'Set a duress phrase');return guardian.setDuress(typeof v.phrase==='string'?v.phrase:null),true;
          case 'reset':if(!['voice','face','all'].includes(String(v.what)))return false;await guardian.sensitive('Erase security prints');await guardian.reset(v.what as 'voice'|'face'|'all');return true;
          case 'lock':guardian.lock('Locked from the screen',true);return true;
          case 'unlock':void guardian.requestUnlock().catch(()=>{});return true;
          case 'answer':{
            if(typeof v.id!=='string'||typeof v.approve!=='boolean')return false;
            const pending=guardian.status().approvals.find(a=>a.id===v.id&&a.via==='desk');if(!pending)return 'gone';
            // At the PC with no phone paired: unlocking also needs Windows Hello when it's set up.
            if(v.approve&&pending.group==='unlock'&&ownerAvailable&&(await owner.status()).configured){
              const scope={action:'guard-unlock',id:v.id};const grant=await owner.verify(scope,AbortSignal.timeout(70000));
              if(!owner.consume(grant,scope))return 'denied';
            }
            return guardian.answer(v.id,{approve:v.approve,pick:v.approve?pending.code:null,trust:v.trust===true},'desk');
          }
        }
      }catch(e){fail(e);}
      throw new Error('Untrusted request');
    });
    ipcMain.handle('harmony:orb',(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;
      if(v.op==='set'){
        const next=readOrbSettings({...orbSettings(),...(typeof v.on==='boolean'?{on:v.on}:{}),...(v.display===null||Number.isSafeInteger(v.display)?{display:v.display}:{}),...(typeof v.corner==='string'?{corner:v.corner}:{}),...(typeof v.drift==='boolean'?{drift:v.drift}:{})});
        budgetDatabase?.prepare("INSERT INTO memory_settings (key,value) VALUES ('orb',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));refreshOrb();
      }else if(v.op!=='get')throw new Error('Untrusted request');
      const s=orbSettings(),list=displayList(),d=pickOrbDisplay(list,s);
      return {settings:s,displays:list.map(({id,label,primary})=>({id,label,primary})),showingOn:d?.label??null};
    });
    ipcMain.handle('harmony:update',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const op=(args[0] as {op?:unknown}).op;if(op!=='apply'&&op!=='undo')throw new Error('Untrusted request');
      try{return {ok:true,message:op==='apply'?await applyUpdate():await undoUpdate()};}
      catch(e){return {ok:false,message:e instanceof GuardDenied?e.message:'The update could not start.'};}
    });
    ipcMain.handle('harmony:gods-eye',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;
      if(v.op==='open'){if(!godsEye.installed)return false;await godsEyeWindow.show({layers:[],place:'',view:null});return true;}
      if(v.op==='close')return godsEyeWindow.close();
      if(v.op==='ambient'&&typeof v.on==='boolean'){if(!godsEye.installed)return false;return godsEyeWindow.setAmbient(v.on);}
      if(v.op==='stop'){await godsEyeWindow.close();await godsEye.stop();return true;}
      if(v.op==='keys')return {...await worldKeys.status(),brief:brief.enabled};
      if(v.op==='brief'&&typeof v.on==='boolean'){brief.setEnabled(v.on);return v.on;}
      if(v.op==='lite'&&typeof v.on==='boolean'){budgetDatabase!.prepare("INSERT INTO memory_settings (key,value) VALUES ('gods_eye_lite',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(v.on?'1':'0');await godsEyeWindow.reloadLite();cache.clear();runtime?.publish();return v.on;}
      if(v.op==='import-v9'){
        // v9 lives on the Desktop ("God's 3rd Eye\server.py"). Only known key names are read; values stay encrypted.
        await guardian.sensitive('Import world data keys');
        const file=join(app.getPath('desktop'),"God's 3rd Eye",'server.py');
        let text:string;try{text=readFileSync(file,'utf8');}catch{return {names:[],error:"I couldn't find God's 3rd Eye\\server.py on your Desktop."};}
        const names=await worldKeys.importV9(text);text='';
        if(names.length){await godsEyeWindow.close();await godsEye.stop();} // next start picks up the keys
        return {names,error:names.length?null:'No keys were found in that file.'};
      }
      if(v.op==='forget-keys'){await guardian.sensitive('Forget world data keys');await worldKeys.clear();await godsEye.stop();return true;}
      throw new Error('Untrusted request');
    });
    ipcMain.handle('harmony:model',async(event,...args:unknown[])=>{if(!trustedWindow(event)||args.length!==1||args[0]!=='harmony-core')throw new Error('Untrusted request');
      const {readFile}=await import('node:fs/promises');const data=await readFile(join(root,'dist','renderer','models','harmony-core.glb'));
      if(data.byteLength>20_000_000)throw new Error('Model too large');return new Uint8Array(data);});
    ipcMain.handle('harmony:mode',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||!MODES.includes(args[0] as HarmonyMode))throw new Error('Untrusted request');modes.set(args[0] as HarmonyMode);return true;});
    ipcMain.handle('harmony:idea',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>;if(typeof v.id!=='string'||!/^[0-9a-f-]{36}$/.test(v.id))throw new Error('Untrusted request');
      let ok=false;if(v.op==='stage'&&IDEA_STAGES.includes(v.stage as IdeaStage))ok=ideas.setStage(v.id,v.stage as IdeaStage);else if(v.op==='remove'&&v.confirm==='delete')ok=ideas.remove(v.id);else throw new Error('Untrusted request');
      runtime?.publish();return ok;});
    ipcMain.handle('harmony:desktop-settings',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('Untrusted request');
      const v=args[0] as Record<string,unknown>,keys=Object.keys(v);if(keys.some(k=>k!=='screen'&&k!=='control'))throw new Error('Untrusted request');
      desktop!.set({...(v.screen!==undefined?{screen:v.screen as 'off'}:{}),...(v.control!==undefined?{control:v.control as boolean}:{})});return true;});
    ipcMain.handle('harmony:local-clear',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted request');validateNoArguments(args);runtime!.clearLocal();});
    ipcMain.handle('harmony:reasoning-connection',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted sender');validateNoArguments(args);return reasoningConnection.status();});
    ipcMain.handle('harmony:reasoning-configure',async(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||reasoningSettingsBusy||runtime!.snapshot().system!=='PASSIVE')throw new Error('Cannot update reasoning connection');reasoningSettingsBusy=true;try{await reasoningConnection.save(args[0]);modelHealth.clear();}finally{reasoningSettingsBusy=false;}});
    ipcMain.handle('harmony:reasoning-forget',async(event,...args:unknown[])=>{if(!chamberSender(event)||reasoningSettingsBusy)throw new Error('Untrusted sender');validateNoArguments(args);reasoningSettingsBusy=true;try{await runtime!.cancelReasoning();await reasoningConnection.clear();}finally{reasoningSettingsBusy=false;}});
    ipcMain.handle('harmony:voice-connection',(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted sender');validateNoArguments(args);return voiceConnection.status();});
    ipcMain.handle('harmony:voice-configure',(event,...args:unknown[])=>{if(!chamberSender(event)||args.length!==1||output.active)throw new Error('Cannot update speech connection');return voiceConnection.save(args[0]);});
    ipcMain.handle('harmony:voice-forget',async(event,...args:unknown[])=>{if(!chamberSender(event))throw new Error('Untrusted sender');validateNoArguments(args);await output.stop();return voiceConnection.clear();});
    ipcMain.handle('harmony:voice-preview',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==2||args[1]!==true)throw new Error('Approve this online preview first');
      validatePreset(args[0]);
      if(runtime!.snapshot().system!=='PASSIVE'||speech.snapshot().state!=='OFF')throw new Error('Stop the microphone test before previewing a voice');
      const generation=output.generation;
      const credentials=await voiceConnection.read();
      if(!credentials)throw new Error('Set up Azure Speech first');
      if(generation!==output.generation||runtime!.snapshot().system!=='PASSIVE'||speech.snapshot().state!=='OFF')throw new Error('Preview cancelled');
      return output.start(args[0],credentials);
    });
    ipcMain.handle('harmony:local-voice-available',(event,...args:unknown[])=>{
      if(!chamberSender(event))throw new Error('Untrusted sender');if(args.length!==1)throw new Error('Invalid local voice arguments');validateLocalVoiceEngine(args[0]);
      return (args[0]==='piper'?['.venv-kokoro/Scripts/python.exe','.runtime/piper/piper/__init__.py','data/models/piper-alba/en_GB-alba-medium.onnx']:['.venv-kokoro/Scripts/python.exe','data/models/kokoro-82m/manifest.json']).every(path=>existsSync(join(root,path)));
    });
    ipcMain.handle('harmony:local-voice-prepare',(event,...args:unknown[])=>{
      if(!chamberSender(event))throw new Error('Untrusted sender');if(args.length!==1)throw new Error('Invalid local voice arguments');validateLocalVoiceEngine(args[0]);
      if(runtime!.snapshot().system!=='PASSIVE'||speech.snapshot().state!=='OFF')throw new Error('Stop microphone work before preparing');
      return output.prepareLocal(args[0]);
    });
    ipcMain.handle('harmony:local-voice-preview',(event,...args:unknown[])=>{
      if(!chamberSender(event))throw new Error('Untrusted sender');if(args.length!==1)throw new Error('Invalid local voice arguments');validateLocalVoiceEngine(args[0]);
      if(runtime!.snapshot().system!=='PASSIVE'||speech.snapshot().state!=='OFF')throw new Error('Stop microphone work before previewing');
      return output.startLocal(args[0]);
    });
    ipcMain.handle('harmony:voice-next',(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==2)throw new Error('Untrusted voice sender');
      validateVoiceRequest(args[0],args[1]);return conversationSpeech.owns(args[0])?conversationSpeech.next(args[0],args[1] as number):output.next(args[0],args[1] as number);
    });
    ipcMain.handle('harmony:voice-playback',(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length!==2||typeof args[1]!=='boolean')throw new Error('Untrusted voice sender');
      validateVoiceRequest(args[0],0);return conversationSpeech.owns(args[0])?conversationSpeech.playback(args[0],args[1]):output.playback(args[0],args[1]);
    });
    ipcMain.handle('harmony:voice-stop',(event,...args:unknown[])=>{
      if(!trustedWindow(event))throw new Error('Untrusted voice sender');validateNoArguments(args);return output.stop();
    });
    const startAudio=async(mode:'test'|'wake')=>{
        if(['PREPARING','STARTING','STREAMING','PLAYING'].includes(output.snapshot().state))throw new Error('Stop the voice preview first');
        if(runtime!.snapshot().system!=='PASSIVE')throw new Error('Runtime is not ready for local audio');
        const result=await speech.start(mode);
        if(runtime!.snapshot().system!=='PASSIVE'){await speech.stop();throw new Error('Audio start cancelled');}
        microphoneUntil=Date.now()+15000;return result;
    };
    for(const [name,operation] of Object.entries({
      'audio-start':()=>startAudio('test'),
      'wake-start':()=>startAudio('wake'),
      'audio-stop':()=>{microphoneUntil=0;return conversation.active?conversation.stop({keepVoice:true}):speech.stop();},
      // Explicit click at this computer; arms the same short microphone grant as the speech test.
      'conversation-stop':()=>{microphoneUntil=0;return runtime!.stopConversation();}
    })) ipcMain.handle(`harmony:${name}`,(event,...args:unknown[])=>{
      if(!window||!trustedSender(event.sender.id,window.webContents.id,event.senderFrame===window.webContents.mainFrame,event.senderFrame?.url??'',documentUrl))throw new Error('Untrusted sender');
      validateNoArguments(args);return operation();
    });
    // Explicit click at this computer; arms the same short microphone grant as the speech test. Hands-free is optional.
    ipcMain.handle('harmony:conversation-start',async(event,...args:unknown[])=>{
      if(!chamberSender(event)||args.length>1||(args.length===1&&typeof args[0]!=='boolean'))throw new Error('Untrusted request');
      if(['PREPARING','STARTING','STREAMING','PLAYING'].includes(output.snapshot().state))throw new Error('Stop the voice preview first');
      const result=await runtime!.startConversation(args[0]===true);microphoneUntil=Date.now()+15000;return result;
    });
    ipcMain.handle('harmony:audio-push',(event,...args:unknown[])=>{
      if(!window||!trustedSender(event.sender.id,window.webContents.id,event.senderFrame===window.webContents.mainFrame,event.senderFrame?.url??'',documentUrl)||args.length!==1)throw new Error('Untrusted audio sender');
      // A frame still in flight when the microphone stops is expected; it is not an error worth logging.
      return speech.push(args[0]).catch((e:unknown)=>{if(e instanceof Error&&e.message==='Audio stopped')return;throw e;});
    });
    window.webContents.on('render-process-gone',()=>{microphoneUntil=0;guardMicUntil=0;cameraUntil=0;void runtime?.stop().catch(()=>{});});
    window.webContents.on('did-start-loading',()=>{void allowance.stop().catch(()=>{});void owner.stop().catch(()=>{});revokeFiles();microphoneUntil=0;void speech.stop().catch(()=>{});void output.stop().catch(()=>{});void reasoning.stop().catch(()=>{});void local.stop().catch(()=>{});void conversation.stop().catch(()=>{});});
    // Efficiency (step 32): a window that can't be seen gets nothing (it catches up when shown), and the mini orb gets
    // only the handful of fields it draws from, not the whole status, so most updates no longer re-render three windows.
    const seen=(w:BrowserWindow|null):w is BrowserWindow=>!!w&&!w.isDestroyed()&&w.isVisible()&&!w.isMinimized();
    const orbView=(x:Snapshot)=>({revision:x.revision,system:x.system,voice:x.voice,identity:x.identity,conversation:x.conversation,focus:x.focus,
      voiceConversation:{state:x.voiceConversation?.state},audio:{state:x.audio?.state},speechOutput:{state:x.speechOutput?.state}});
    runtime.updates.subscribe(snapshot => {
      lastSnapshotRef.value=snapshot;lastSnapshotRef.lite=orbView;
      if (seen(window)) window.webContents.send('harmony:state', snapshot);
      if (seen(companion)) companion.webContents.send('harmony:state', snapshot);
      if (seen(orb)) orb.webContents.send('harmony:state', orbView(snapshot));
    });
    const catchUp=(w:BrowserWindow|null)=>{if(lastSnapshotRef.value&&w&&!w.isDestroyed())w.webContents.send('harmony:state',lastSnapshotRef.value);};
    for (const e of ['show','restore'] as const) window.on(e as 'show',()=>catchUp(window));
    // Started with Windows (--background, Settings → System): she loads and warms up without a window, so opening her
    // later ("Launch HARMONY" or the orb) is instant. The window shows on the next launch (second-instance).
    window.on('ready-to-show', () => {mark('window shown');if(!process.argv.includes('--background'))window?.show();});
    window.on('closed', () => { window = null; companion?.close(); orb?.close(); });
    for (const e of ['show','hide','minimize','restore','moved'] as const) window.on(e as 'show', refreshOrb);
    await window.loadFile(documentPath);mark('page loaded');
    setTimeout(()=>{void (async()=>{try{const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(join(root,'.runtime'),{recursive:true});await writeFile(join(root,'.runtime','startup.json'),JSON.stringify({at:new Date().toISOString(),marks},null,1));}catch{}})();},20000).unref?.();
    if (process.argv.includes('--companion')) await floatDesktop();
    refreshOrb();
  }).catch(() => { console.error('HARMONY desktop startup failed.'); app.exit(1); });
}
function updateText(u:UpdateStatus):string{
  const what=u.commits.slice(0,4).map(c=>c.subject.replace(/[:.]\s.*$/,'')).filter(Boolean);
  return `HARMONY has ${u.commits.length>1?`${u.commits.length} updates`:'an update'} ready${what.length?`: ${what.join('; ')}`:''}. Say "update yourself" or click Update.`.slice(0,300);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (closing || !runtime) return;
  event.preventDefault();
  closing = true;
  reminderScheduler?.stop();reminderScheduler=null;for(const w of watchers)w.stop();watchers=[];
  runtime.close().then(async () => {await memoryEmbedder?.stop().catch(()=>{});await desktop?.stop().catch(()=>{});budgetDatabase?.close();budgetDatabase=null;app.quit();}).catch(() => { console.error('Worker shutdown could not be verified.'); app.exit(1); });
});
