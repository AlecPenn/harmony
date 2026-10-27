import {TaskPlanner} from './task-planner.ts';
import type {AllowanceController} from './allowance-controller.ts';
import type {ReasoningController} from './reasoning-controller.ts';
import type {LocalReasoningController} from './local-reasoning.ts';
import type {ConversationController} from './conversation.ts';
import {emptyConversation} from '../packages/contracts/conversation.ts';
import {emptyReminders,type RemindersStatus} from './reminders.ts';
import {emptyMemory,type MemoryStatus} from '../packages/contracts/memory.ts';
import {emptyLocalReasoning} from '../packages/contracts/local-reasoning.ts';
import {emptyReasoning} from '../packages/contracts/reasoning.ts';
import {filePreviewTool} from '../packages/tools/file-preview.ts';
import type {ReadOnlyFiles} from '../packages/files/read-only.ts';
import type {ToolDefinition} from '../packages/tools/registry.ts';
import {LatencyProfiler} from '../packages/telemetry/latency.ts';
import {ActionJournal} from './action-journal.ts';
import {ToolDispatcher} from './tool-dispatcher.ts';
import {ToolRegistry} from '../packages/tools/registry.ts';
import {computerInfoTool,type ComputerInfo} from '../packages/tools/computer-info.ts';
import {PermissionPolicy,actionInputHash} from '../packages/permissions/policy.ts';
import type { VoiceOutput } from './voice-output.ts';
import { emptyVoiceOutput } from '../packages/contracts/voice-output.ts';
import { performance } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';
import { defaults, validateConfig } from '../packages/config/index.ts';
import type { Config } from '../packages/config/index.ts';
import type { ConfigStore } from '../packages/config/store.ts';
import type { Capability, Snapshot } from '../packages/contracts/index.ts';
import { record } from '../packages/logging/index.ts';
import { openDatabase } from './storage.ts';
import { StateEngine } from './state.ts';
import { EventBus } from './events.ts';
import type { HealthWorker } from './worker.ts';
import { ApplicationEventBus } from './application-events.ts';
import type { ApplicationEvent, TurnContext } from '../packages/contracts/events.ts';
import type { SpeechWorker } from './speech-worker.ts';
import { emptyAudio } from '../packages/contracts/audio.ts';

const journalEvents = {
  APP_STARTED: 'runtime.started', APP_READY: 'runtime.ready', APP_FAILED: 'runtime.failed',
  HEALTH_STARTED: 'health.started', HEALTH_PASSED: 'health.passed', HEALTH_FAILED: 'health.failed',
  STOP_REQUESTED: 'runtime.stop_requested', WORK_STOPPED: 'runtime.stopped'
} as const;

const PUBLISH_MS = 60;
export class Runtime {
  #toolProfiler=new LatencyProfiler();#showToolLatency=false;#showReasoningLatency=false;#showLocalLatency=false;#showConversationLatency=false;
  #computerInfo:ComputerInfo|null=null;
  /** Reminders and timers (set by the desktop main process once storage is open). */
  reminders:{snapshot():RemindersStatus}|null=null;
  /** Things the person asked HARMONY to remember. */
  memory:{snapshot():MemoryStatus}|null=null;
  /** Google connection (read-only Calendar/Gmail). */
  google:{snapshot():import('./google.ts').GoogleStatus}|null=null;
  /** Projects and the active one (Phase 25). */
  projects:{snapshot():import('./projects.ts').ProjectsStatus}|null=null;
  desktop:{snapshot():import('./desktop.ts').DesktopStatus;stop():Promise<void>}|null=null;
  modes:{snapshot():import('../packages/contracts/index.ts').ModesStatus}|null=null;
  notices:{snapshot():import('./interruptions.ts').Notice[]}|null=null;
  missions:{snapshot():import('./missions.ts').MissionSummary[]}|null=null;
  skills:{snapshot():import('./skills.ts').SkillStatus[]}|null=null;
  media:{snapshot():import('./media.ts').MediaItem[]}|null=null;
  companion:{snapshot():import('./companion.ts').CompanionStatus}|null=null;
  guard:{snapshot():import('./guardian.ts').GuardStatus}|null=null;
  update:{snapshot():import('./updater.ts').UpdateStatus}|null=null;
  work:{snapshot():{jobs:import('./worklog.ts').JobView[];summary:string}}|null=null;
  wake:{snapshot():import('./wake-learner.ts').WakeStats}|null=null;
  drills:{snapshot():import('./security-drills.ts').DrillReport|null}|null=null;
  connectivity:{snapshot():import('./connectivity.ts').ConnectivityStatus}|null=null;
  speed:{snapshot():import('./speed-scoreboard.ts').Scoreboard}|null=null;
  jobs:{snapshot():import('./job-scout.ts').JobsView}|null=null;
  gestures:{snapshot():import('./gestures.ts').GestureView}|null=null;
  routines:{snapshot():(import('./routines.ts').Routine&{plain:string})[]}|null=null;
  network:{snapshot():import('./network-watch.ts').NetworkView&{on:boolean}}|null=null;
  inbox:{snapshot():(import('./inbox-triage.ts').TriageResult&{drafts:Record<string,import('./inbox-triage.ts').Draft>})|null}|null=null;
  godsEye:{snapshot():import('./gods-eye.ts').GodsEyeStatus}|null=null;
  backups:{snapshot():{list:import('./backup.ts').BackupInfo[];restorePending:boolean;restored:boolean}}|null=null;
  personality:{snapshot():import('../packages/contracts/index.ts').PersonalitySnapshot}|null=null;
  #actions:{tool:string;state:string;time:string}[]=[];
  readonly updates = new EventBus<Snapshot>();
  #applicationEvents = new ApplicationEventBus();
  #state = new StateEngine();
  #db: DatabaseSync | null = null;
  #worker: HealthWorker;
  #databasePath: string;
  #events: Snapshot['events'] = [];
  #revision = 0;
  #lastCheck: Snapshot['lastCheck'] = null;
  #task: Promise<void> | null = null;
  #abort: AbortController | null = null;
  #stopTask: Promise<void> | null = null;
  #shutdownFailed = false;
  #workerResult: 'unchecked' | 'passed' | 'failed' = 'unchecked';
  #databaseOk = false;
  #config: Config = structuredClone(defaults);
  #configStore?: ConfigStore;
  #lastWakeCount=0;
  private audio?: Pick<SpeechWorker,'snapshot'|'stop'>;
  private output?: Pick<VoiceOutput,'active'|'snapshot'|'trace'|'stop'>;
  constructor(databasePath: string, worker: HealthWorker, configStore?: ConfigStore, audio?: Pick<SpeechWorker,'snapshot'|'stop'>, output?: Pick<VoiceOutput,'active'|'snapshot'|'trace'|'stop'>, private reasoning?:ReasoningController,private owner?:{readonly active:boolean;stop():Promise<void>},private allowance?:AllowanceController,private local?:LocalReasoningController,private conversation?:ConversationController) {
    this.output=output;
    this.audio=audio;
    this.#databasePath = databasePath; this.#worker = worker; this.#configStore = configStore;
    this.#applicationEvents.subscribe(event => this.#projectEvent(event));
    this.#state.changes.subscribe(state => this.#applicationEvents.emit('STATE_CHANGED', state));
  }
  subscribeEvents(listener: (event: ApplicationEvent) => void): () => void { return this.#applicationEvents.subscribe(listener); }
  snapshot(): Snapshot {
    const capabilities: Capability[] = [
      { id: 'database', name: 'Local storage', status: this.#databaseOk ? 'AVAILABLE' : 'TEMPORARILY_FAILED', detail: this.#databaseOk ? 'SQLite integrity verified. Stored on this computer.' : 'Storage has not passed verification.' },
      { id: 'python', name: 'Python health worker', status: this.#workerResult === 'passed' ? 'AVAILABLE' : this.#workerResult === 'failed' ? 'TEMPORARILY_FAILED' : 'UNAVAILABLE', detail: this.#workerResult === 'passed' ? 'Startup, response and shutdown verified.' : this.#workerResult === 'failed' ? 'Could not verify the worker. Check Python installation.' : 'Run a local check to verify the worker.' },
      { id: 'voice', name: 'Voice', status: 'UNAVAILABLE', detail: 'Optional local British test and online Australian audition are in Settings. Only the online audition needs an account. Live conversation is not connected.' },
      { id: 'ai', name: 'Intelligence', status: this.local?.snapshot().model.state==='READY'||this.reasoning?.snapshot().state==='FINISHED'?'AVAILABLE':'DISCONNECTED', detail: this.local?(this.local.snapshot().model.state==='NOT_INSTALLED'?'Free local model not installed yet. ':'Free private local model on this computer. ')+'Optional cloud models need a saved API key, local allowance and separate approvals. Microphone conversation is not connected.':this.reasoning?'Typed Luna, Sol and Astra requests require a saved API key, local allowance and separate cost/answer approvals. Microphone conversation is not connected.':'AI adapter not connected. No cloud requests.' },
      (()=>{let d:import('./desktop.ts').DesktopStatus|null=null;try{d=this.desktop?.snapshot()??null;}catch{}
        return { id: 'automation', name: 'Computer control', status: d?.available&&d.control?'AVAILABLE':'UNAVAILABLE', detail: !d?.available?'Windows only.':d.control?'Opens apps and websites, switches windows, media and volume. Each action is journaled; most can be undone.':'Turned off in Settings.' } as Capability;})()
    ];
    return structuredClone({ allowance:this.allowance?.snapshot(), computerInfo:this.#computerInfo,actions:this.#actions, reasoning:this.reasoning?.snapshot()??emptyReasoning, localReasoning:this.local?.snapshot()??emptyLocalReasoning, voiceConversation:this.conversation?.snapshot()??emptyConversation, reminders:(()=>{try{return this.reminders?.snapshot()??emptyReminders;}catch{return emptyReminders;}})(), memory:(()=>{try{return this.memory?.snapshot()??emptyMemory;}catch{return emptyMemory;}})(), google:(()=>{try{return this.google?.snapshot()??undefined;}catch{return undefined;}})(), projects:(()=>{try{return this.projects?.snapshot()??undefined;}catch{return undefined;}})(), desktop:(()=>{try{return this.desktop?.snapshot()??undefined;}catch{return undefined;}})(), modes:(()=>{try{return this.modes?.snapshot()??undefined;}catch{return undefined;}})(), notices:(()=>{try{return this.notices?.snapshot()??undefined;}catch{return undefined;}})(), missions:(()=>{try{return this.missions?.snapshot()??undefined;}catch{return undefined;}})(), skills:(()=>{try{return this.skills?.snapshot()??undefined;}catch{return undefined;}})(), media:(()=>{try{return this.media?.snapshot()??undefined;}catch{return undefined;}})(), backups:(()=>{try{return this.backups?.snapshot()??undefined;}catch{return undefined;}})(), companion:(()=>{try{return this.companion?.snapshot()??undefined;}catch{return undefined;}})(), guard:(()=>{try{return this.guard?.snapshot()??undefined;}catch{return undefined;}})(), update:(()=>{try{return this.update?.snapshot()??undefined;}catch{return undefined;}})(), work:(()=>{try{return this.guard?.snapshot().locked?undefined:this.work?.snapshot()??undefined;}catch{return undefined;}})(), wake:(()=>{try{return this.wake?.snapshot()??undefined;}catch{return undefined;}})(), drills:(()=>{try{return this.drills?.snapshot()??undefined;}catch{return undefined;}})(), connectivity:(()=>{try{return this.connectivity?.snapshot()??undefined;}catch{return undefined;}})(), speed:(()=>{try{return this.speed?.snapshot()??undefined;}catch{return undefined;}})(), inbox:(()=>{try{return this.guard?.snapshot().locked?undefined:this.inbox?.snapshot()??undefined;}catch{return undefined;}})(), jobs:(()=>{try{return this.guard?.snapshot().locked?undefined:this.jobs?.snapshot()??undefined;}catch{return undefined;}})(), gestures:(()=>{try{return this.gestures?.snapshot()??undefined;}catch{return undefined;}})(), network:(()=>{try{return this.guard?.snapshot().locked?undefined:this.network?.snapshot()??undefined;}catch{return undefined;}})(), routines:(()=>{try{return this.guard?.snapshot().locked?undefined:this.routines?.snapshot()??undefined;}catch{return undefined;}})(), godsEye:(()=>{try{return this.godsEye?.snapshot()??undefined;}catch{return undefined;}})(), personality:(()=>{try{return this.personality?.snapshot()??undefined;}catch{return undefined;}})(), latency:this.#showConversationLatency?this.conversation?.snapshot().trace??null:this.#showToolLatency?this.#toolProfiler.snapshot():this.#showLocalLatency?this.local?.snapshot().trace??null:this.#showReasoningLatency?this.reasoning?.snapshot().trace??null:this.output?.trace?.()??null, revision: this.#revision, stopping: !!this.#stopTask, shutdownFailed: this.#shutdownFailed, ...this.#state.snapshot(), worker: this.#worker.state, voicePreference: `${this.#config.voice.locale} · ${this.#config.voice.presentation}`, capabilities, events: this.#events, lastCheck: this.#lastCheck, eventDiagnostics: this.#applicationEvents.diagnostics, speechOutput: this.output?.snapshot() ?? emptyVoiceOutput, audio: this.audio?.snapshot() ?? emptyAudio });
  }
  publishOutput() { if(['PREPARING','STARTING'].includes(this.output?.snapshot().state??'')){this.#showToolLatency=false;this.#showReasoningLatency=false;}this.#applicationEvents.emit('VOICE_OUTPUT_CHANGED',{state:this.output?.snapshot().state??'IDLE'}); }
  publishReasoning(){
    const state=this.reasoning?.snapshot().state;
    if(state==='REVIEW'||state==='STREAMING'||state==='ESTIMATE_REVIEW'||state==='ESTIMATING'){this.#showReasoningLatency=true;this.#showToolLatency=false;this.#showLocalLatency=false;}
    if(!['STOPPED','ERROR','BOOTING','OFF'].includes(this.#state.value)){
      if(this.reasoning?.active){const next=state==='REVIEW'||state==='ESTIMATE_REVIEW'?'ACTIVE':'BUSY';if(this.#state.value!==next)this.#state.transition(next);}
      else if(!this.#task&&!this.allowance?.active&&!this.local?.busy&&!this.conversation?.active&&['ACTIVE','BUSY'].includes(this.#state.value))this.#state.transition('PASSIVE');
    }
    this.publish();
  }
  publishAllowance(){
    if(!['STOPPED','ERROR','BOOTING','OFF'].includes(this.#state.value)){
      if(this.allowance?.active){const next=this.allowance.snapshot().state==='REVIEW'?'ACTIVE':'BUSY';if(this.#state.value!==next)this.#state.transition(next);}
      else if(!this.#task&&!this.reasoning?.active&&!this.local?.busy&&!this.conversation?.active&&['ACTIVE','BUSY'].includes(this.#state.value))this.#state.transition('PASSIVE');
    }this.publish();
  }
  reviewAllowance(amount:unknown){
    if(!this.allowance||this.#state.value!=='PASSIVE'||this.#task||this.#stopTask||this.owner?.active||this.output?.active||(this.audio&&this.audio.snapshot().state!=='OFF'))throw new Error('Allowance review unavailable');
    this.allowance.review(amount);
  }
  approveAllowance(id:unknown){if(!this.allowance||this.#state.value!=='ACTIVE'||this.#stopTask||this.owner?.active)throw new Error('Allowance review unavailable');return this.allowance.approve(id,new AbortController().signal);}
  async cancelAllowance(){await this.allowance?.stop();}
  runOwnerAction(operation:(signal:AbortSignal)=>Promise<void>):Promise<void>{
    if(!this.owner||this.#state.value!=='PASSIVE'||this.#task||this.#stopTask||this.owner.active||this.reasoning?.active||this.output?.active||(this.audio&&this.audio.snapshot().state!=='OFF'))return Promise.reject(new Error('Owner controls are unavailable'));
    const controller=new AbortController();this.#abort=controller;this.#state.transition('BUSY');
    this.#task=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return operation(controller.signal);}).finally(()=>{
      this.#task=null;this.#abort=null;if(this.#state.value==='BUSY')this.#state.transition('PASSIVE');this.publish();
    });this.publish();return this.#task;
  }
  reviewReasoning(text:unknown,model?:unknown){
    if(!this.reasoning||this.#state.value!=='PASSIVE'||this.#task||this.#stopTask||this.output?.active||(this.audio&&this.audio.snapshot().state!=='OFF'))throw new Error('Stop voice work before reviewing a request');
    this.reasoning.review(text,model);
  }
  approveReasoning(id:unknown){if(!this.reasoning||this.#state.value!=='ACTIVE'||this.#stopTask)throw new Error('Request review unavailable');this.reasoning.approve(id);}
  async cancelReasoning(){await this.reasoning?.stop();}
  publishLocal(){
    if(this.local?.busy){this.#showLocalLatency=true;this.#showToolLatency=false;this.#showReasoningLatency=false;}
    if(!['STOPPED','ERROR','BOOTING','OFF'].includes(this.#state.value)){
      if(this.local?.busy){if(this.#state.value!=='BUSY')this.#state.transition('BUSY');}
      else if(!this.#task&&!this.reasoning?.active&&!this.allowance?.active&&this.#state.value==='BUSY')this.#state.transition('PASSIVE');
    }
    this.publish();
  }
  /** Free typed request to the local model. No cost, allowance or cloud access is involved. */
  askLocal(text:unknown){
    if(!this.local||this.#state.value!=='PASSIVE'||this.#task||this.#stopTask||this.reasoning?.active||this.allowance?.active||this.owner?.active||this.output?.active||(this.audio&&this.audio.snapshot().state!=='OFF'))throw new Error('HARMONY is busy');
    this.local.ask(text);
  }
  async cancelLocal(){await this.local?.cancel();}
  clearLocal(){this.local?.clear();this.publish();}
  publishConversation(){
    // Busy, not merely warm: a voice kept loaded between announcements does not hold the runtime ACTIVE.
    const active=!!(this.conversation?.busy??this.conversation?.active);
    if(active){this.#showConversationLatency=true;this.#showToolLatency=false;this.#showReasoningLatency=false;this.#showLocalLatency=false;}
    if(!['STOPPED','ERROR','BOOTING','OFF'].includes(this.#state.value)){
      if(active){if(this.#state.value!=='ACTIVE')this.#state.transition('ACTIVE');}
      else if(!this.#task&&!this.reasoning?.active&&!this.allowance?.active&&!this.local?.busy&&this.#state.value==='ACTIVE')this.#state.transition('PASSIVE');
    }
    this.publish();
  }
  /** Explicit local desktop voice conversation. Requires an idle runtime; STOP ends it. */
  startConversation(handsFree=false){
    if(!this.conversation||this.#state.value!=='PASSIVE'||this.#task||this.#stopTask||this.reasoning?.active||this.allowance?.active||this.owner?.active||this.local?.busy||this.output?.active||(this.audio&&this.audio.snapshot().state!=='OFF'))throw new Error('HARMONY is busy');
    return this.conversation.start({handsFree:handsFree===true});
  }
  async stopConversation(){await this.conversation?.stop();}
  publishAudio() {
    const audio=this.audio?.snapshot()??emptyAudio;
    if(audio.wakeCount>this.#lastWakeCount&&audio.wakeConfidence!==null)this.#applicationEvents.emit('WAKE_HEARD',{confidence:audio.wakeConfidence});
    this.#lastWakeCount=audio.wakeCount;
    this.#applicationEvents.emit('AUDIO_CHANGED', {state:audio.state});
  }
  publish() { this.#applicationEvents.emit('WORKER_CHANGED', { state: this.#worker.state }); }
  #projectEvent(event: ApplicationEvent) {
    if (Object.hasOwn(journalEvents, event.type)) {
      const name = journalEvents[event.type as keyof typeof journalEvents];
      try { if (this.#db) record(this.#db, name, name.endsWith('failed') ? 'error' : 'info'); }
      catch {
        this.#databaseOk = false;
        if (!['ERROR', 'STOPPED'].includes(this.#state.value)) this.#state.transition('ERROR');
      }
      // Payloads never enter the journal or renderer. Only allowlisted lifecycle metadata does.
      this.#events = [...this.#events.slice(-39), { id: event.sequence, time: event.time, name,
        type: event.type, turnId: event.turnId, generation: event.generation, monotonicMs: event.monotonicMs }];
    }
    this.#revision++;
    // Bursts of events (audio, partial transcripts, several stores changing at once) used to build and send a full
    // snapshot to every window for each one. Now they're coalesced: at most one snapshot every 60 ms, always the latest.
    if (this.#publishTimer) return;
    this.#publishTimer = setTimeout(() => { this.#publishTimer = null; this.updates.publish(this.snapshot()); }, PUBLISH_MS);
  }
  #publishTimer: ReturnType<typeof setTimeout> | null = null;
  boot(): void {
    if (this.#shutdownFailed) throw new Error('Shutdown is not stopped and verified; retry STOP');
    if (this.#task || this.#stopTask) throw new Error('Runtime is still stopping');
    this.#state.transition('BOOTING');
    this.publish();
    try {
      this.#config = this.#configStore ? this.#configStore.load() : validateConfig(defaults);
      if (!this.#db) {this.#db = openDatabase(this.#databasePath);new ActionJournal(this.#db).recoverInterrupted();}
      this.#applicationEvents.emit('APP_STARTED', undefined);
      if (this.#state.value === 'ERROR') throw new Error('Journal failed');
      this.#databaseOk = this.#db.prepare('PRAGMA quick_check').get()?.quick_check === 'ok';
      if (!this.#databaseOk) throw new Error('Storage verification failed');
      this.#state.transition('PASSIVE');
      this.#applicationEvents.emit('APP_READY', undefined);
    } catch {
      this.#databaseOk = false;
      if (this.#state.value !== 'ERROR') this.#state.transition('ERROR');
      this.#applicationEvents.emit('APP_FAILED', undefined);
    }
  }
  check(): Promise<void> {
    if (this.#state.value !== 'PASSIVE' || this.#task || this.#stopTask) return Promise.reject(new Error('Runtime is not ready'));
    const controller = new AbortController();
    this.#abort = controller;
    const turn = this.#applicationEvents.beginTurn();
    this.#task = Promise.resolve().then(() => this.#runCheck(controller, turn)).finally(() => {
      this.#applicationEvents.endTurn(turn); this.#task = null; this.#abort = null;
    });
    this.#state.transition('BUSY');
    return this.#task;
  }
  async #runCheck(controller: AbortController, turn: TurnContext): Promise<void> {
    const start = performance.now();
    let passed = false;
    try {
      controller.signal.throwIfAborted();
      this.#applicationEvents.emit('HEALTH_STARTED', undefined, turn);
      if (!this.#databaseOk || !this.#db || this.#db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') {
        this.#databaseOk = false;
        throw new Error('Database failed');
      }
      await this.#worker.check(controller.signal);
      await this.#worker.stop();
      controller.signal.throwIfAborted();
      this.#workerResult = 'passed';
      passed = true;
    } catch {
      if (!controller.signal.aborted) this.#workerResult = 'failed';
      try { await this.#worker.stop(); } catch { this.#workerResult = 'failed'; }
    } finally {
      if (!controller.signal.aborted) {
        this.#lastCheck = { time: new Date().toISOString(), durationMs: Math.round(performance.now() - start), passed };
        if (this.#state.value !== 'ERROR') this.#state.transition(passed ? 'PASSIVE' : 'ERROR');
        this.#applicationEvents.emit(passed ? 'HEALTH_PASSED' : 'HEALTH_FAILED', undefined, turn);
      }
    }
  }
  inspectComputer():Promise<void>{return this.#runLocalTool(computerInfoTool,{},result=>{this.#computerInfo=result as ComputerInfo;}).then(()=>{});}
  previewFile(files:ReadOnlyFiles,path:string):Promise<{text:string;bytes:number}>{return this.#runLocalTool(filePreviewTool(files),{path}).then(result=>result as {text:string;bytes:number});}
  #runLocalTool(tool:ToolDefinition,inputs:unknown,onResult:(result:unknown)=>void=()=>{}):Promise<unknown>{
    if(this.#state.value!=='PASSIVE'||this.#task||this.#stopTask||!this.#db)throw new Error('Runtime is not ready');
    const turn=this.#applicationEvents.beginTurn(),controller=new AbortController();this.#abort=controller;
    const registry=new ToolRegistry();registry.register(tool);
    // Explicit local diagnostic authority, never an enrolled person or voice identity.
    const policy=new PermissionPolicy(registry.policies(),[{id:'local_desktop',permissions:[...tool.permissions]}],{denyTools:[],lowRiskWriteTools:[]});
    const journal=new ActionJournal(this.#db);
    let startSpan:ReturnType<LatencyProfiler['start']>=null;
    const authority={isCurrent:(t:TurnContext)=>this.#applicationEvents.isCurrent(t),identifies:(person:string,t:TurnContext)=>person==='local_desktop'&&t===turn&&this.#applicationEvents.isCurrent(t)};
    const dispatcher=new ToolDispatcher(registry,()=>policy,journal,authority,()=>{this.#toolProfiler.end(startSpan);});
    this.#toolProfiler.begin('tool');this.#showToolLatency=true;this.#showReasoningLatency=false;
    for(const field of ['wake_ms','speaker_id_ms','speech_end_ms','stt_ms','intent_ms','model_router_ms','llm_first_token_ms','tts_first_audio_ms'] as const)this.#toolProfiler.notApplicable(field);
    startSpan=this.#toolProfiler.start('tool_start_ms');
    let returned:unknown;const span=this.#toolProfiler.start('tool_complete_ms');let outcome:'completed'|'failed'|'cancelled'='failed';
    this.#task=Promise.resolve().then(async()=>{
      // Fixed trusted template: the explicit desktop request is the whole scope (one call of one SAFE tool).
      const planner=new TaskPlanner(registry,dispatcher,journal,authority);
      const scope={requestHash:actionInputHash({operation:tool.id,inputs}),maxSteps:1,tools:{[tool.id]:{maxCalls:1}}};
      const {handle}=planner.prepare(scope,'trusted_template',[{id:'requested_read',toolId:tool.id,inputs}],turn,'local_desktop');
      const report=await planner.execute(handle,turn,'local_desktop',controller.signal,outputs=>{
        controller.signal.throwIfAborted();if(!this.#applicationEvents.isCurrent(turn)||outputs.length!==1)throw new Error('Tool result expired');
        returned=outputs[0].result;onResult(returned);
      });
      if(report.state!=='SUCCEEDED'||controller.signal.aborted||!this.#applicationEvents.isCurrent(turn))throw new Error('Tool result expired');
      outcome='completed';
    }).finally(()=>{
      if(controller.signal.aborted)outcome='cancelled';
      this.#toolProfiler.end(span,outcome);this.#toolProfiler.finish(outcome);
      try{this.#actions=journal.recent(20).filter(a=>a.person_id==='local_desktop').slice(0,10).map(a=>({tool:String(a.tool_id),state:String(a.state),time:String(a.updated_at)}));}catch{this.#databaseOk=false;throw new Error('Action history unavailable');}finally{
      this.#applicationEvents.endTurn(turn);this.#task=null;this.#abort=null;
      if(this.#state.value==='BUSY')this.#state.transition(this.#databaseOk?'PASSIVE':'ERROR');this.publish();}
    });
    this.#state.transition('BUSY');return this.#task.then(()=>returned);
  }
  stop(): Promise<void> {
    if (this.#stopTask) return this.#stopTask;
    if (!this.#shutdownFailed && !this.#task && !this.reasoning?.active && !this.local?.active && !this.conversation?.active && !this.owner?.active&&!this.allowance?.active && !this.output?.active && this.#state.value === 'STOPPED' && this.#worker.state === 'OFF' && (!this.audio || this.audio.snapshot().state === 'OFF')) return Promise.resolve();
    this.#stopTask = Promise.resolve().then(async () => {
      try {
        // Start every shutdown independently, including when another throws synchronously.
        const results = await Promise.allSettled([
          Promise.resolve().then(() => this.output?.stop()),
          Promise.resolve().then(() => this.audio?.stop()),
          Promise.resolve().then(() => this.#worker.stop()),
          Promise.resolve().then(() => this.reasoning?.stop()),
          Promise.resolve().then(() => this.local?.stop()),
          Promise.resolve().then(() => this.conversation?.stop()),
          Promise.resolve().then(() => this.owner?.stop()),
          Promise.resolve().then(() => this.allowance?.stop())
        ]);
        await this.#task?.catch(()=>{});
        if (results.some(result => result.status === 'rejected') || this.reasoning?.active || this.local?.active || this.conversation?.active || this.owner?.active || this.allowance?.active || this.output?.active ||
            this.#worker.state !== 'OFF' || (this.audio && this.audio.snapshot().state !== 'OFF')) {
          throw new Error('Shutdown unverified');
        }
        this.#shutdownFailed = false;
        this.#applicationEvents.emit('WORK_STOPPED', undefined);
      } catch {
        this.#shutdownFailed = true;
        this.#workerResult = 'failed';
        this.publish();
        throw new Error('Shutdown could not be verified');
      }
    }).finally(() => { this.#stopTask = null; this.publish(); });
    this.#applicationEvents.cancelAll();
    this.#abort?.abort();
    if (this.#state.value !== 'STOPPED') this.#state.transition('STOPPED');
    this.#applicationEvents.emit('STOP_REQUESTED', undefined);
    return this.#stopTask;
  }
  resume(): void {
    if (this.#state.value !== 'STOPPED' && this.#state.value !== 'ERROR') throw new Error('Runtime is not stopped');
    if (this.#task || this.#stopTask) throw new Error('Runtime is still stopping');
    if (this.#shutdownFailed || this.reasoning?.active || this.local?.active || this.conversation?.active || this.owner?.active || this.allowance?.active || this.#worker.state !== 'OFF' || this.output?.active || (this.audio && this.audio.snapshot().state !== 'OFF')) throw new Error('Worker is not stopped');
    this.boot();
  }
  async close(): Promise<void> {
    await this.stop();
    this.#db?.close(); this.#db = null;
  }
}
