import {AllowanceSetup} from './AllowanceSetup.tsx';
import {LiteOrb} from './LiteOrb.tsx';
import {OwnerSetup} from './OwnerSetup.tsx';
import {ReasoningPanel} from './ReasoningPanel.tsx';
import {LocalAskPanel} from './LocalAskPanel.tsx';
import {ConversationBar} from './ConversationBar.tsx';
import {MemoryPanel} from './MemoryPanel.tsx';
import {GoogleSetup} from './GoogleSetup.tsx';
import {ProjectsPanel} from './ProjectsPanel.tsx';
import {ScreenControlPanel} from './ScreenControlPanel.tsx';
import {IdeasPanel} from './IdeasPanel.tsx';
import {NoticeTray} from './NoticeTray.tsx';
import {MissionsPanel} from './MissionsPanel.tsx';
import {SkillsPanel} from './SkillsPanel.tsx';
import {MediaChamber} from './MediaChamber.tsx';
import {PersonalityPanel} from './PersonalityPanel.tsx';
import {BackupsPanel} from './BackupsPanel.tsx';
import {OffsitePanel} from './OffsitePanel.tsx';
import {WorkPanel} from './WorkPanel.tsx';
import {InboxPanel} from './InboxPanel.tsx';
import {JobsPanel} from './JobsPanel.tsx';
import {HomePanel} from './HomePanel.tsx';
import {GestureCamera,GesturePanel} from './GesturePanel.tsx';
import {WakePanel} from './WakePanel.tsx';
import {DrillsPanel} from './DrillsPanel.tsx';
import {SpeedPanel,StartupPanel} from './SpeedPanel.tsx';
import {WifiPanel} from './WifiPanel.tsx';
import {TaughtSkillsPanel} from './TaughtSkillsPanel.tsx';
import {CompanionPanel} from './CompanionPanel.tsx';
import {SecurityPanel} from './SecurityPanel.tsx';
import {GuardLayer} from './GuardLayer.tsx';
import {UpdateBanner} from './UpdateBanner.tsx';
import {MiniOrb,OrbPanel} from './MiniOrb.tsx';
import {GodsEyePanel} from './GodsEyePanel.tsx';
import {ReminderTray} from './ReminderTray.tsx';
import {ReasoningSetup} from './ReasoningSetup.tsx';
import {FilePreview} from './FilePreview.tsx';
import {LatencyPanel} from './LatencyPanel.tsx';
import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'framer-motion';
import type { HarmonyBridge } from '../../../packages/contracts/index.ts';
import { presenceMode, processingVisualBudget } from './presence-model.ts';
import { useChamber, type Panel } from './chamber-store.ts';
import {VoiceSetup} from './VoiceSetup.tsx';
import { VoicePlayback } from './voice-playback.ts';
import type { VoicePreset,LocalVoiceEngine } from '../../../packages/contracts/voice-output.ts';
import { LocalCapture } from './local-capture.ts';
import './style.css';
import { Companion } from './Companion.tsx';
const Presence = lazy(() => import('./Presence.tsx'));
declare global { interface Window { harmony?: HarmonyBridge } }
const labels: Record<string, string> = {
  'runtime.started':'Local runtime started','runtime.ready':'Ready for local checks','runtime.failed':'Local runtime needs attention',
  'health.started':'Local health check started','health.passed':'Local health check passed','health.failed':'Health check needs attention',
  'runtime.stop_requested':'Stop requested','runtime.stopped':'Work stopped'
};
const panelTitles = { activity:'Behind the scenes',system:'What’s online',settings:'Your HARMONY',projects:'Projects',work:'Work log',inbox:'Inbox and today',jobs:'Job scout',memory:'Memory',media:'Media chamber' };
function App() {
  const { snapshot,panel,ingest,setPanel }=useChamber();
  const [error,setError]=useState(''); const [pending,setPending]=useState(false);
  const [command,setCommand]=useState(''); const [reply,setReply]=useState('');
  const [success,setSuccess]=useState(false);
  const [wakePulse,setWakePulse]=useState(false);
  // Project worlds: the atmosphere follows the current project (same controls underneath).
  const world=snapshot?.projects?.active?.project.world??'default';
  useEffect(()=>{document.documentElement.dataset.world=world;},[world]);
  const mode=snapshot?.modes?.mode??'normal';
  useEffect(()=>{document.documentElement.dataset.mode=mode;},[mode]);
  // Easter-egg flourishes play for a few seconds; reduced motion keeps them still.
  const flourishAt=snapshot?.personality?.flourish?.at,flourishKind=snapshot?.personality?.flourish?.kind;
  useEffect(()=>{if(!flourishAt||!flourishKind||Date.now()-Date.parse(flourishAt)>10000)return;document.documentElement.dataset.flourish=flourishKind;
   const t=setTimeout(()=>{delete document.documentElement.dataset.flourish;},flourishKind==='dramatic'?6000:3500);return ()=>clearTimeout(t);},[flourishAt,flourishKind]);
  const [bootShown,setBootShown]=useState(true);useEffect(()=>{const t=setTimeout(()=>setBootShown(false),60000);return ()=>clearTimeout(t);},[]);
  useEffect(()=>{
    if(!snapshot?.audio.wakeCandidateCount){setWakePulse(false);return;}
    setWakePulse(true);const timer=setTimeout(()=>setWakePulse(false),900);return ()=>clearTimeout(timer);
  },[snapshot?.audio.wakeCandidateCount]);
  const [reducedMotion,setReducedMotion]=useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [quietVisuals,setQuietVisuals]=useState(false);
  const previousFocus=useRef<HTMLElement|null>(null); const closeButton=useRef<HTMLButtonElement>(null);
  const capture=useRef<LocalCapture|null>(null);
  const playback=useRef<VoicePlayback|null>(null);
  const [voiceConfigured,setVoiceConfigured]=useState(false);
  const [voiceEngine,setVoiceEngine]=useState<LocalVoiceEngine>('kokoro');
  const [voiceChanging,setVoiceChanging]=useState(false);
  const [localVoiceAvailable,setLocalVoiceAvailable]=useState(false);
  useEffect(()=>{let active=true;window.harmony?.localVoiceAvailable(voiceEngine).then(value=>{if(active)setLocalVoiceAvailable(value);}).catch(()=>{if(active)setLocalVoiceAvailable(false);});return()=>{active=false;};},[voiceEngine]);
  const [voiceApproved,setVoiceApproved]=useState(false);
  const [voicePreset,setVoicePreset]=useState<VoicePreset>('natural');
  const voiceBusy=voiceChanging||['PREPARING','STARTING','STREAMING','PLAYING'].includes(snapshot?.speechOutput?.state??'');
  useEffect(()=>{
    if(window.harmony)playback.current=new VoicePlayback(window.harmony,setError);
    return ()=>{void playback.current?.stop().catch(()=>{});playback.current=null;};
  },[]);
  useEffect(()=>{if(snapshot?.system==='STOPPED'||snapshot?.speechOutput?.state==='ERROR')void playback.current?.stop().catch(()=>{});},[snapshot?.system,snapshot?.speechOutput?.state]);
  useEffect(()=>{
    if(window.harmony)capture.current=new LocalCapture(window.harmony,setError);
    return ()=>{void capture.current?.stop();capture.current=null;};
  },[]);
  useEffect(()=>{
    if(snapshot?.system==='STOPPED'||snapshot?.audio.state==='ERROR'||(snapshot?.audio.state==='OFF'&&capture.current?.active))void capture.current?.stop();
  },[snapshot?.system,snapshot?.audio.state]);
  const still=reducedMotion||quietVisuals;
  useEffect(()=>{
    const query=matchMedia('(prefers-reduced-motion: reduce)'); const change=()=>setReducedMotion(query.matches);
    query.addEventListener('change',change); return ()=>query.removeEventListener('change',change);
  },[]);
  useEffect(()=>{
    const bridge=window.harmony;if(!bridge)return;let active=true;
    const update=(next: Parameters<typeof ingest>[0])=>{if(active)ingest(next);};
    const unsubscribe=bridge.subscribe(update);bridge.snapshot().then(update).catch(()=>setError('Could not connect to the local core. Restart HARMONY.'));
    return ()=>{active=false;unsubscribe();};
  },[ingest]);
  useEffect(()=>{
    if(!snapshot?.lastCheck?.passed)return;setSuccess(true);const timer=setTimeout(()=>setSuccess(false),900);return ()=>clearTimeout(timer);
  },[snapshot?.lastCheck?.time]);
  useEffect(()=>{ if(panel)closeButton.current?.focus(); },[panel]);
  function closePanel(){setPanel(null);previousFocus.current?.focus();}
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();void action('stop');setPanel(null);previousFocus.current?.focus();}};window.addEventListener('keydown',escape);return ()=>window.removeEventListener('keydown',escape);},[setPanel]);
  const system=snapshot?.system??'DISCONNECTED';const busy=system==='BUSY';const stopped=system==='STOPPED';
  const needsRecovery=stopped||system==='ERROR';
  function openPanel(next:Panel){previousFocus.current=document.activeElement as HTMLElement;setPanel(panel===next?null:next);}
  async function action(name:'check'|'stop'|'resume'){
    if(!window.harmony)return;
    if(name!=='stop')setPending(true);setError('');
    try{if(name==='stop'){void capture.current?.stop();void playback.current?.stop().catch(()=>{});}await window.harmony[name]();}catch{setError(name==='stop'?'Stop requested, but worker shutdown could not be verified.':'That operation could not complete. Open System for details.');setPanel('system');}
    finally{if(name!=='stop')setPending(false);}
  }
  async function submit(event:React.FormEvent){
    event.preventDefault();const input=command.trim().toLowerCase().replace(/^\//,'');setCommand('');
    if(input==='check'){setPanel('activity');await action('check');setReply('Local check requested. Results appear in Activity.');}
    else if(input==='stop'){await action('stop');setReply('Stop requested.');}
    else if(input==='resume'){await action('resume');setReply('Resume requested.');}
    else if(input==='status'){setPanel('system');setReply('Showing verified local capabilities.');}
    else setReply('Available local commands: /check, /status, /stop, /resume. Use Ask HARMONY in System for reviewed typed requests.');
  }
  return <main className={`app state-${system.toLowerCase()}`}>
    <div className="ambient-field" aria-hidden="true"/>
    <header className="topbar">
      {mode!=='normal'&&<div className="mode-chip" role="status">{mode==='focus'?'LOCKED IN':'GHOST'}<button className="text-button" onClick={()=>{void window.harmony?.setMode('normal').catch(()=>{});}}>Back to normal</button></div>}
      <div className="brand"><span className="brand-mark">H</span><span>HARMONY<small>PERSONAL INTELLIGENCE</small></span></div>
      <div className="top-status"><i className={snapshot?'online':''}/>{snapshot?'LOCAL CORE CONNECTED':'CORE DISCONNECTED'}</div>
      <div className="top-controls">{snapshot?.godsEye&&<button className="gods-eye-button" title={snapshot.godsEye.state==='NOT_INSTALLED'?'Run "Set up God\u2019s Eye" in the HARMONY folder first':'Open the live globe'} disabled={snapshot.godsEye.state==='NOT_INSTALLED'||snapshot.godsEye.state==='STARTING'} onClick={()=>{setError('');void window.harmony?.godsEye({op:'open'}).catch(()=>setError('God\u2019s Eye could not open.'));}}>{snapshot.godsEye.state==='STARTING'?'Starting God\u2019s Eye…':'God\u2019s Eye'}</button>}<button onClick={()=>{void window.harmony?.floatDesktop().catch(()=>setError('Could not open the desktop companion.'));}}>Float on desktop</button><span className="mode-label">{snapshot?.focus??'OFFLINE'}</span><button onClick={()=>openPanel('settings')} aria-label="Open settings" aria-expanded={panel==='settings'}>Settings <span aria-hidden="true">↗</span></button></div>
    </header>
    <section className="chamber" aria-label="HARMONY presence">
      <div className="chamber-heading"><p className="eyebrow">{bootShown&&snapshot?.personality?.bootLine?snapshot.personality.bootLine:'A LITTLE ORDER. A LITTLE ATTITUDE.'}</p><h1>Your space. In harmony.</h1></div>
      {panel?<div className="presence presence-lite" aria-hidden="true"><LiteOrb mode={wakePulse&&(system==='PASSIVE'||snapshot?.voiceConversation?.state==='WAITING')?'wake':presenceMode(snapshot,success)}/></div>:<Suspense fallback={<div className="presence" aria-hidden="true"/>}><Presence mode={wakePulse&&(system==='PASSIVE'||snapshot?.voiceConversation?.state==='WAITING')?'wake':presenceMode(snapshot,success)} reducedMotion={quietVisuals} resourceConstrained={processingVisualBudget(snapshot)}/></Suspense>}
      <div className="presence-caption"><span className="state-pill">{system==='PASSIVE'?'STANDING BY':system.replaceAll('_',' ')}</span><p>{snapshot?.reasoning?.state==='STREAMING'?'Receiving a cloud response.':snapshot?.reasoning?.state==='ESTIMATING'?'Getting a cloud cost estimate.':['REVIEW','ESTIMATE_REVIEW'].includes(snapshot?.reasoning?.state??'')?'Waiting for your review.':snapshot?.allowance?.state==='VERIFYING'?'Waiting for Windows verification.':snapshot?.allowance?.state==='REVIEW'?'Waiting for your allowance review.':busy?'Working locally.':stopped?'Taking a breather.':system==='ERROR'?'A little attention, please.':'Here when you need me.'}</p></div>
      <ConversationBar status={snapshot?.voiceConversation} system={system} capture={capture} playback={playback} recognizer={snapshot?.audio.mode==='conversation'?snapshot.audio.engine:null}/>
      <nav className="context-nav" aria-label="Workspace panels">
        {(['activity','system','projects','work','inbox','jobs','memory','media'] as const).map((item,i)=><button key={item} onClick={()=>openPanel(item)} aria-expanded={panel===item} aria-controls="context-panel"><span aria-hidden="true">{['≋','◈','▱','⚒','✉','◇','✧','▤'][i]}</span>{item[0].toUpperCase()+item.slice(1)}</button>)}
      </nav>
      <AnimatePresence mode="wait">
        {panel&&<motion.section key={panel} id="context-panel" className={`context-panel panel-${panel}`} aria-labelledby="panel-heading" initial={still?false:{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:still?0:.18}}>
          <div className="section-heading"><h2 id="panel-heading">{panelTitles[panel]}</h2><button ref={closeButton} onClick={closePanel} aria-label="Close panel">×</button></div>
          {panel==='activity'&&<><p className="panel-intro">What actually happened, as it happened.</p><ol aria-label="Recent runtime events">{snapshot?.events.slice(-8).reverse().map(item=><li key={item.id}><time>{new Date(item.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><span>{labels[item.name]??item.name}</span></li>)}</ol>{!snapshot?.events.length&&<p>No runtime events yet.</p>}</>}
          {panel==='system'&&<div className="capability-list">{snapshot?.capabilities.map(item=><div className="capability" key={item.id}><div><h3>{item.name}</h3><p>{item.detail}</p></div><span className={`capability-status status-${item.status.toLowerCase()}`}>{item.status==='AVAILABLE'?'Ready':item.status==='TEMPORARILY_FAILED'?'Needs attention':item.status==='DISCONNECTED'?'Disconnected':item.id==='python'?'Not checked':'Not built yet'}</span></div>)}</div>}
          {panel==='system'&&<><SpeedPanel board={snapshot?.speed}/><StartupPanel/><WifiPanel status={snapshot?.network}/></>}
          {panel==='system'&&<LocalAskPanel status={snapshot?.localReasoning} system={system}/>}
          {panel==='system'&&<ReasoningPanel status={snapshot?.reasoning} system={system}/>}
          {panel==='system'&&<section><h3>This computer</h3><button className="text-button" disabled={system!=='PASSIVE'||pending} onClick={()=>{setError('');void window.harmony?.inspectComputer().catch(()=>setError('Computer inspection did not complete.'));}}>Inspect this computer</button>{snapshot?.computerInfo&&<dl aria-label="Computer overview"><dt>Operating system</dt><dd>{snapshot.computerInfo.operatingSystem}</dd><dt>Architecture</dt><dd>{snapshot.computerInfo.architecture}</dd><dt>Available processors</dt><dd>{snapshot.computerInfo.logicalCores}</dd><dt>Memory</dt><dd>{snapshot.computerInfo.memoryGiB} GiB</dd></dl>}</section>}
          {panel==='activity'&&!!snapshot?.actions?.length&&<section><h3>Recent local actions</h3><ul aria-label="Recent local actions">{snapshot.actions.map((a,i)=><li key={i}>{a.tool} · {a.state.toLowerCase().replaceAll('_',' ')}</li>)}</ul></section>}
          {panel==='activity'&&<LatencyPanel trace={snapshot?.latency??null} voice={snapshot?.speechOutput}/>}
          {panel==='settings'&&<><HomePanel/><SecurityPanel status={snapshot?.guard} phonePaired={!!snapshot?.companion?.enabled&&!!snapshot.companion.devices.length}/><WakePanel stats={snapshot?.wake}/><GesturePanel status={snapshot?.gestures}/><DrillsPanel report={snapshot?.drills}/><GodsEyePanel status={snapshot?.godsEye}/><OwnerSetup disabled={!snapshot||system!=='PASSIVE'}/><AllowanceSetup status={snapshot?.allowance} system={system}/><ReasoningSetup disabled={!snapshot||system!=='PASSIVE'}/><GoogleSetup status={snapshot?.google} disabled={!snapshot||system!=='PASSIVE'}/><ScreenControlPanel status={snapshot?.desktop}/><PersonalityPanel status={snapshot?.personality}/><SkillsPanel skills={snapshot?.skills}/><TaughtSkillsPanel routines={snapshot?.routines}/><CompanionPanel status={snapshot?.companion}/><OrbPanel/><BackupsPanel status={snapshot?.backups}/><OffsitePanel/><section className="local-voice-test"><p className="eyebrow">OPTIONAL LOCAL AUDITION</p><h3>British female · offline test</h3><p className="panel-intro">No account needed. This is a British test voice; your Australian female preference stays unchanged. Only a fixed sample is spoken. The microphone stays off.</p><label className="setting"><span>Local test voice</span><select aria-label="Local test voice" value={voiceEngine} disabled={voiceBusy} onChange={event=>{const engine=event.target.value as LocalVoiceEngine;setVoiceChanging(true);void playback.current?.stop().then(()=>setVoiceEngine(engine)).catch(()=>setError('Voice could not be unloaded. Try STOP first.')).finally(()=>setVoiceChanging(false));}}><option value="kokoro">Kokoro · Emma</option><option value="piper">Piper · Alba (Scottish fallback)</option></select></label><p className="panel-intro">{voiceEngine==='kokoro'?'First start warms the model and can take 30–60 seconds on this computer.':'Alba is a Scottish female test voice. Piper is faster here; naturalness is yours to compare. First start still warms the model.'} Later previews reuse it. STOP unloads it.</p><button className="text-button" disabled={!localVoiceAvailable||voiceBusy||!snapshot||system!=='PASSIVE'||snapshot.audio.state!=='OFF'||snapshot.speechOutput?.state==='READY'} onClick={()=>{setError('');void window.harmony?.localVoicePrepare(voiceEngine).catch(()=>setError('Local voice could not be prepared. Try again or open System.'));}}>Prepare local voice silently</button><p className="panel-intro" role="status">{snapshot?.speechOutput?.provider==='local'&&snapshot.speechOutput.state==='PREPARING'?({model:'Loading the local voice model…',acknowledgements:'Preparing quick acknowledgements…',warmup:'Warming the local voice…',ready:'Finishing voice preparation…'}[snapshot.speechOutput.preparation?.at(-1)?.stage??'model']+' No audio will play.'):snapshot?.speechOutput?.provider==='local'&&snapshot.speechOutput.state==='READY'?'Local voice is warm and ready.':'Preparation loads the model into memory without speaking.'}</p><button className="primary" disabled={!localVoiceAvailable||voiceBusy||!snapshot||system!=='PASSIVE'||snapshot.audio.state!=='OFF'} onClick={()=>{setError('');void playback.current?.start('natural',false,true,voiceEngine);}}>Hear British local test</button><button className="text-button" disabled={!voiceBusy&&snapshot?.speechOutput?.provider!=='local'} onClick={()=>void playback.current?.stop().catch(()=>setError('Voice shutdown could not be verified.'))}>Stop local preview</button>{!localVoiceAvailable&&<p className="panel-intro">Local model files are not installed on this copy.</p>}</section><p className="eyebrow">A VOICE WITH PERSONALITY</p><h3 className="voice-heading">Australian. Female.<br/><em>Unmistakably HARMONY.</em></h3><p className="panel-intro">Optional online Australian female voices, with three pacing options. A Speech account is needed only for this online audition.</p><VoiceSetup busy={voiceBusy} onConfigured={setVoiceConfigured}/><div className="voice-audition"><label htmlFor="voice-pacing">Voice pacing</label><select id="voice-pacing" value={voicePreset} onChange={event=>setVoicePreset(event.target.value as VoicePreset)} disabled={voiceBusy}><option value="natural">Natural</option><option value="relaxed">Relaxed</option><option value="brisk">Brisk</option></select><p className="panel-intro">Online preview · Only the fixed sample below is sent to Microsoft. Your microphone stays off.</p><details className="audition-script"><summary>Read the sample script</summary><blockquote>Hi, I'm Harmony. A little order, a little attitude. I can help you keep track of your projects, and pick up where we left off. One thing at a time. We've got this.</blockquote></details><label className="voice-consent"><input type="checkbox" checked={voiceApproved} disabled={!voiceConfigured||voiceBusy} onChange={e=>setVoiceApproved(e.target.checked)}/>I approve this fixed online preview and any Azure usage charge.</label><button className="primary" disabled={!voiceConfigured||!voiceApproved||!snapshot||system!=='PASSIVE'||snapshot.audio.state!=='OFF'||voiceBusy} onClick={()=>{setError('');void playback.current?.start(voicePreset,voiceApproved);setVoiceApproved(false);}}>Hear HARMONY</button><button className="text-button" disabled={!voiceBusy} onClick={()=>void playback.current?.stop().catch(()=>setError('Voice shutdown could not be verified.'))}>Stop voice preview</button><p className="panel-intro" role="status">{snapshot?.speechOutput?.state==='PLAYING'?'Playing voice preview':snapshot?.speechOutput?.state==='STARTING'?(snapshot.speechOutput.provider==='local'?'Warming the local voice…':'Connecting to voice service…'):snapshot?.speechOutput?.state==='FINISHED'?'Preview finished':snapshot?.speechOutput?.state==='ERROR'?snapshot.speechOutput.error:'Ready to audition'}</p>{snapshot?.speechOutput?.tts_first_audio_ms!=null&&<details className="voice-timing"><summary>Voice timing</summary><p>First audio ready: {snapshot.speechOutput.tts_first_audio_ms} ms<br/>Playback reported: {snapshot.speechOutput.playback_start_ms??'pending'} ms</p></details>}</div><label className="setting"><span>Calm visuals<small>Pause motion for this session</small></span><input type="checkbox" checked={quietVisuals} onChange={event=>setQuietVisuals(event.target.checked)}/></label><p className="panel-intro">Automatic cloud spending is disabled. Each online preview requires your approval. Live conversation is not connected.</p>
<div className="audio-test"><h3>Local microphone test</h3><p className="panel-intro">Audio stays on this computer. Temporary transcription only; no wake word, speaker verification or commands yet.</p><button className="primary" disabled={!snapshot||system!=='PASSIVE'||snapshot.audio.state==='STARTING'||snapshot.audio.state==='STOPPING'} onClick={()=>{setError('');if(snapshot?.audio.state==='CAPTURING'||snapshot?.audio.state==='READY')void capture.current?.stop();else void capture.current?.start();}}>{snapshot?.audio.state==='STARTING'?'Loading local speech…':snapshot?.audio.state==='CAPTURING'||snapshot?.audio.state==='READY'?'Stop microphone test':'Start microphone test'}</button><p className="panel-intro" role="status">Audio: {snapshot?.audio.state??'OFF'} · {snapshot?.audio.receivedFrames??0} chunks</p><button className="text-button" disabled={!snapshot||system!=='PASSIVE'||snapshot.audio.state!=='OFF'} onClick={()=>{setError('');void capture.current?.start('wake');}}>Start wake-word test</button><p className="panel-intro">Wake matches: {snapshot?.audio.wakeCount??0}. Detection does not verify identity or enable commands.</p>{snapshot?.audio.transcript&&<p className="transcript" aria-live="polite">{snapshot.audio.transcript}<small>{snapshot.audio.transcriptFinal?'Final segment':'Partial · may change'}</small></p>}</div></>}
          {panel==='work'&&<WorkPanel status={snapshot?.work}/>}
          {panel==='inbox'&&<InboxPanel status={snapshot?.inbox}/>}
          {panel==='jobs'&&<JobsPanel status={snapshot?.jobs}/>}
          {panel==='projects'&&<FilePreview system={system}/>}
          {panel==='projects'&&<ProjectsPanel status={snapshot?.projects}/>}
          {panel==='projects'&&<MissionsPanel missions={snapshot?.missions}/>}
          {panel==='projects'&&<IdeasPanel status={snapshot?.modes}/>}
          {panel==='memory'&&<MemoryPanel status={snapshot?.memory}/>}
          {panel==='media'&&<MediaChamber items={snapshot?.media}/>}
        </motion.section>}
      </AnimatePresence>
    </section>
    <section className="dock-area" aria-label="Command dock">
      {snapshot?.desktop?.looking&&<p className="looking-banner" role="status">Looking at your screen…</p>}
      {(error||!window.harmony)&&<p className="error-banner" role="alert">{error||'Desktop connection unavailable. Open the desktop launcher to use controls.'}</p>}
      {snapshot?.shutdownFailed&&<p className="error-banner" role="alert">Shutdown could not be verified. Press STOP to retry before resuming.</p>}
      {snapshot?.desktop?.screen==='watch'&&<p className="looking-banner" role="status">Watching for new errors on screen</p>}
      {snapshot?.connectivity&&!snapshot.connectivity.online&&<p className="looking-banner offline-banner" role="status">Offline since {new Date(snapshot.connectivity.since).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}: working on this PC; web questions wait until it's back.</p>}
      <GuardLayer status={snapshot?.guard}/><GestureCamera status={snapshot?.gestures}/>
      <UpdateBanner status={snapshot?.update}/>
      <NoticeTray notices={snapshot?.notices}/>
      <ReminderTray status={snapshot?.reminders}/>
      {reply&&<p className="command-reply" role="status">{reply}</p>}
      <div className="command-bar"><form onSubmit={submit}><label className="sr-only" htmlFor="command">Local command</label><span className="command-symbol" aria-hidden="true">⌘</span><input id="command" value={command} onChange={event=>setCommand(event.target.value)} maxLength={256} placeholder="Try /check or /status" autoComplete="off" disabled={!snapshot}/><button type="submit" aria-label="Run local command" disabled={!snapshot||!command.trim()}>↵</button></form><button className="primary" onClick={()=>{setPanel('activity');void action(needsRecovery?'resume':'check');}} disabled={!snapshot||snapshot.stopping||snapshot.shutdownFailed||pending||busy||system==='ACTIVE'||system==='BOOTING'}>{needsRecovery?'Resume HARMONY':busy?(snapshot?.reasoning?.state==='STREAMING'?'Reasoning…':snapshot?.reasoning?.state==='ESTIMATING'?'Estimating…':'Checking…'):'Run local check'}</button><button className="stop" onClick={()=>action('stop')} disabled={!snapshot||snapshot.stopping||(stopped&&!snapshot.shutdownFailed&&snapshot.worker==='OFF'&&snapshot.audio.state==='OFF')} aria-label="Stop all work">■ STOP</button></div>
      <div className="dock-meta"><span className="mic-off">○ {snapshot?.audio.state==='CAPTURING'?(snapshot.audio.mode==='wake'?'MICROPHONE ON · WAKE TEST':snapshot.audio.mode==='conversation'?(snapshot.voiceConversation?.handsFree?'MICROPHONE ON · HANDS-FREE':'MICROPHONE ON · CONVERSATION'):'MICROPHONE ON · LOCAL TEST'):snapshot?.audio.state==='READY'?'MICROPHONE STARTING':'MICROPHONE OFF'}</span><span>{snapshot?.lastCheck?`Last check ${snapshot.lastCheck.passed?'passed':'failed'} · ${snapshot.lastCheck.durationMs} ms`:'Local commands · Voice conversation not connected'}</span><span>WORKER {snapshot?.worker??'UNKNOWN'}</span></div>
    </section>
    <footer><span>HIGHLY ADVANCED REMINDER MACHINE OCCASIONALLY NAGGING YOU</span><span>LOCAL FIRST. ALWAYS YOURS.</span></footer>
    <div className="sr-only" role="status" aria-live="polite">Runtime {system}.</div>
  </main>;
}
const floating = location.hash === '#companion', orbPage = location.hash === '#orb';
if (floating || orbPage) document.documentElement.classList.add('companion-document');
createRoot(document.getElementById('root')!).render(<StrictMode>{orbPage ? <MiniOrb/> : floating ? <Companion/> : <App/>}</StrictMode>);
