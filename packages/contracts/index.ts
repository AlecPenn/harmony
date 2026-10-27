export type SystemState = 'OFF' | 'BOOTING' | 'PASSIVE' | 'ACTIVE' | 'BUSY' | 'ERROR' | 'STOPPED';
export type VoiceState = 'DISABLED' | 'WAKE_ONLY' | 'LISTENING' | 'TRANSCRIBING' | 'THINKING' | 'SPEAKING' | 'INTERRUPTED';
export type IdentityState = 'UNKNOWN' | 'DETECTING' | 'AUTHORIZED' | 'UNCERTAIN' | 'REJECTED';
export type ConversationState = 'NONE' | 'WAKE' | 'ACTIVE' | 'FOLLOWUP' | 'ENDING';
export type FocusState = 'NORMAL' | 'FOCUS' | 'CREATIVE' | 'MEETING' | 'GHOST' | 'NIGHT';
export interface RuntimeState {
  system: SystemState;
  voice: VoiceState;
  identity: IdentityState;
  conversation: ConversationState;
  focus: FocusState;
}
export type CapabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'DISCONNECTED' | 'REQUIRES_PERMISSION' | 'TEMPORARILY_FAILED';
export type WorkerState = 'OFF' | 'STARTING' | 'READY' | 'STOPPING' | 'FAILED';
export interface Capability { id: string; name: string; status: CapabilityStatus; detail: string }
export interface RuntimeEvent {
  id: number; time: string; name: string;
  type: import('./events.ts').ApplicationEventName;
  turnId: string | null; generation: number; monotonicMs: number;
}
export interface Snapshot extends RuntimeState {
  allowance?:{history?:import('./allowance.ts').AllowanceHistoryEntry[]|null;state:'IDLE'|'REVIEW'|'VERIFYING'|'CREATED'|'CANCELLED'|'ERROR';reviewId:string|null;limitMicros:number|null;error:string|null;balance:{limitMicros:number;committedMicros:number;remainingMicros:number;waitingMicros:number;uncertainMicros:number;settledMicros:number;unresolvedCount:number}|null};
  reasoning?:import('./reasoning.ts').ReasoningStatus;
  localReasoning?:import('./local-reasoning.ts').LocalReasoningStatus;
  voiceConversation?:import('./conversation.ts').ConversationStatus;
  reminders?:import('./reminders.ts').RemindersStatus;
  memory?:import('./memory.ts').MemoryStatus;
  google?:import('../../core/google.ts').GoogleStatus;
  projects?:import('../../core/projects.ts').ProjectsStatus;
  desktop?:import('../../core/desktop.ts').DesktopStatus;
  modes?:ModesStatus;
  notices?:import('../../core/interruptions.ts').Notice[];
  missions?:import('../../core/missions.ts').MissionSummary[];
  skills?:import('../../core/skills.ts').SkillStatus[];
  media?:import('../../core/media.ts').MediaItem[];
  personality?:PersonalitySnapshot;
  companion?:import('../../core/companion.ts').CompanionStatus;
  guard?:import('../../core/guardian.ts').GuardStatus;
  update?:import('../../core/updater.ts').UpdateStatus;
  work?:{jobs:import('../../core/worklog.ts').JobView[];summary:string};
  wake?:import('../../core/wake-learner.ts').WakeStats;
  drills?:import('../../core/security-drills.ts').DrillReport|null;
  connectivity?:import('../../core/connectivity.ts').ConnectivityStatus;
  speed?:import('../../core/speed-scoreboard.ts').Scoreboard;
  jobs?:import('../../core/job-scout.ts').JobsView;
  gestures?:import('../../core/gestures.ts').GestureView;
  network?:import('../../core/network-watch.ts').NetworkView&{on:boolean;reconnect?:import('../../core/wifi-reconnect.ts').ReconnectView};
  routines?:(import('../../core/routines.ts').Routine&{plain:string})[];
  inbox?:import('../../core/inbox-triage.ts').TriageResult&{drafts:Record<string,import('../../core/inbox-triage.ts').Draft>};
  godsEye?:import('../../core/gods-eye.ts').GodsEyeStatus;
  backups?:{list:import('../../core/backup.ts').BackupInfo[];restorePending:boolean;restored:boolean};
  computerInfo?: import('../tools/computer-info.ts').ComputerInfo|null;
  actions?:{tool:string;state:string;time:string}[];
  latency?: import('./latency.ts').LatencyTrace|null;
  revision: number;
  stopping?: boolean;
  shutdownFailed?: boolean;
  system: SystemState;
  worker: WorkerState;
  voicePreference: string;
  capabilities: Capability[];
  events: RuntimeEvent[];
  lastCheck: { time: string; durationMs: number; passed: boolean } | null;
  eventDiagnostics: { observerFailures: number; droppedEvents: number };
  speechOutput?: import('./voice-output.ts').VoiceOutputStatus;
  audio: import('./audio.ts').AudioStatus;
}
export interface HarmonyBridge {
  allowanceReview(amount:string):Promise<void>;
  allowanceApprove(id:string):Promise<void>;
  allowanceCancel():Promise<void>;
  ownerStatus():Promise<{configured:boolean;available:boolean;method:'windows-webauthn'}>;
  ownerEnroll():Promise<void>;
  reasoningReview(text:string,model?:import('../reasoning/selection.ts').ReasoningChoice):Promise<void>;
  reasoningApprove(reviewId:string):Promise<void>;
  reasoningCancel():Promise<void>;
  reasoningConnection():Promise<import('./reasoning-connection.ts').ReasoningConnectionStatus>;
  reasoningConfigure(value:import('./reasoning-connection.ts').ReasoningConnection):Promise<void>;
  reasoningForget():Promise<void>;
  localAsk(text:string):Promise<void>;
  localCancel():Promise<void>;
  localClear():Promise<void>;
  conversationStart(handsFree?:boolean):Promise<{sessionId:string}>;
  conversationStop():Promise<void>;
  reminderCancel(id:string):Promise<boolean>;
  reminderDismiss(id:string):Promise<boolean>;
  openSource(url:string):Promise<boolean>;
  googleImport():Promise<{ok:boolean;message:string|null}>;
  project(request:Record<string,unknown>):Promise<{ok:boolean;message:string|null}>;
  googleConnect(caps:('calendar'|'gmail')[]):Promise<{ok:boolean;message:string|null}>;
  googleDisconnect(how:'disconnect'|'forget'):Promise<{ok:boolean;message:string|null}>;
  memoryAdd(text:string):Promise<boolean>;
  memoryForget(id:string):Promise<boolean>;
  memoryForgetAll():Promise<number>;
  memorySearch(query:string):Promise<import('./memory.ts').MemorySearchHit[]>;
  memoryPin(id:string,pinned:boolean):Promise<boolean>;
  memoryEpisodes(on:boolean):Promise<boolean>;
  memoryForgetEpisodes():Promise<number>;
  desktopSettings(settings:{screen?:'off'|'on-demand'|'watch';control?:boolean}):Promise<boolean>;
  dismissNotice(id:string):Promise<boolean>;
  cancelMission(id:string):Promise<boolean>;
  setSkill(id:string,on:boolean):Promise<boolean>;
  setPersonality(value:{profile:string;traits?:Record<string,number>}):Promise<boolean>;
  model(name:'harmony-core'):Promise<Uint8Array>;
  companion(request:{op:'enable';on:boolean}|{op:'code'}|{op:'forget';id:string}):Promise<boolean>;
  update(request:{op:'apply'|'undo'}):Promise<{ok:boolean;message:string}>;
  inbox(request:{op:'refresh'}|{op:'draft'|'compose'|'open';id:string}|{op:'edit';id:string;body:string}):Promise<{ok:boolean;message:string|null}>;
  drills(request:{op:'run'}):Promise<{passed:number;failed:number}|null>;
  gesture(request:{op:'frame';jpeg:string}|{op:'settings';patch:Partial<import('../../core/gestures.ts').GestureSettings>}):Promise<{watching:boolean;hand?:boolean}>;
  network(request:{op:'scan'}|{op:'label';mac:string;label:string|null}|{op:'forget';mac:string}|{op:'on';on:boolean}|{op:'reconnect';on:boolean}):Promise<boolean>;
  startup(request:{op:'get'}|{op:'set';atLogin:boolean}):Promise<{atLogin:boolean;available:boolean}>;
  routines(request:{op:'approve'|'remove';id:string}):Promise<boolean>;
  jobs(request:{op:'profile';profile:Partial<import('../../core/job-scout.ts').JobProfile>}|{op:'scout';on:boolean}|{op:'mark';url:string;status:'new'|'saved'|'applied'|'hidden'}|{op:'open';url:string}):Promise<{ok:boolean;message:string|null}>;
  wake(request:{op:'teach'|'teach-not';pcm:string}|{op:'reset'}):Promise<{ok:boolean;count:number;reason:string|null}>;
  work(request:{op:'add';place:string;title:string}|{op:'done'|'reopen'|'receipt';id:string}|{op:'open-file';file:string}):Promise<{ok:boolean;message:string|null}>;
  offsite(request:{op:'get'|'disable'|'now'}|{op:'enable';targets:string[]}|{op:'confirm';last:string}|{op:'restore';recovery:string}):Promise<{status:import('../../core/offsite-backup.ts').OffsiteStatus;places:{path:string;label:string}[];recovery?:string|null;confirmed?:boolean;message?:string|null;error?:string}>;
  orb(request:{op:'get'}|{op:'set';on?:boolean;display?:number|null;corner?:import('../../core/orb-display.ts').Corner;drift?:boolean}):Promise<{settings:import('../../core/orb-display.ts').OrbSettings;displays:{id:number;label:string;primary:boolean}[];showingOn:string|null}>;
  godsEye(request:{op:'open'|'close'|'stop'|'keys'|'import-v9'|'forget-keys'}|{op:'brief'|'lite'|'ambient';on:boolean}):Promise<unknown>;
  guard(request:{op:'settings';patch:Partial<import('../../core/guardian.ts').GuardSettings>}|{op:'arm-mic'}|{op:'arm-camera';purpose:'enroll'|'check'}|{op:'voice';pcm:string}
   |{op:'face';jpeg:string;purpose:'enroll'|'check'}|{op:'duress';phrase:string|null}|{op:'reset';what:'voice'|'face'|'all'}|{op:'lock'}|{op:'unlock'}
   |{op:'answer';id:string;approve:boolean;trust?:boolean}):Promise<unknown>;
  backup(request:{op:'create'}|{op:'restore';name:string;confirm:'restore'}|{op:'cancel-restore'}):Promise<boolean>;
  setMode(mode:'normal'|'focus'|'ghost'):Promise<boolean>;
  idea(request:{op:'stage';id:string;stage:string}|{op:'remove';id:string;confirm:'delete'}):Promise<boolean>;
  localVoiceAvailable(engine?:import('./voice-output.ts').LocalVoiceEngine):Promise<boolean>;
  localVoicePrepare(engine?:import('./voice-output.ts').LocalVoiceEngine):Promise<boolean>;
  localVoicePreview(engine?:import('./voice-output.ts').LocalVoiceEngine):Promise<{sessionId:string}>;
  fileRoot():Promise<string|null>;
  chooseFileRoot():Promise<string|null>;
  forgetFileRoot():Promise<void>;
  previewFile(path:string):Promise<{text:string;bytes:number}>;
  inspectComputer():Promise<void>;
  voiceConnection(): Promise<import('./voice-connection.ts').VoiceConnectionStatus>;
  voiceConfigure(value:import('./voice-connection.ts').VoiceConnection): Promise<void>;
  voiceForget(): Promise<void>;
  voicePreview(preset: import('./voice-output.ts').VoicePreset, approved:boolean): Promise<{sessionId:string}>;
  voiceNext(id:string, sequence:number): Promise<import('./voice-output.ts').VoiceChunk>;
  voicePlayback(id:string, finished:boolean): Promise<void>;
  voiceStop(): Promise<void>;
  floatDesktop(): Promise<void>;
  showChamber(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  check(): Promise<void>;
  stop(): Promise<void>;
  resume(): Promise<void>;
  audioStart(): Promise<{ sessionId: string }>;
  wakeStart(): Promise<{ sessionId: string }>;
  audioPush(frame: import('./audio.ts').AudioFrame): Promise<void>;
  audioStop(): Promise<void>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
}

/** Current mode (normal, focus, ghost) and captured ideas, newest first (archived last). */
export interface ModesStatus {mode:'normal'|'focus'|'ghost';since:string|null;ideas:{id:string;at:string;text:string;stage:'NEW'|'EXPLORE'|'ATTACK'|'TEST'|'BUILD'|'ARCHIVE';project:string|null}[];}

/** Personality profile and dials, the last easter-egg flourish (for the visual effect) and the rare boot line, if any. */
export type PersonalitySnapshot=import('../../core/personality.ts').PersonalityStatus&{flourish:{kind:string;at:string}|null;bootLine:string|null;};
