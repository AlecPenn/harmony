import type { RuntimeState } from '../../../packages/contracts/index.ts';
export type PresenceMode = 'idle' | 'wake' | 'listening' | 'thinking' | 'speaking' | 'success' | 'warning' | 'stopped' | 'offline';
export function presenceMode(state: (RuntimeState & {speechOutput?: {state:string};voiceConversation?: {state:string}}) | null, success = false): PresenceMode {
  if (!state || state.system === 'OFF') return 'offline';
  const local = state.voiceConversation?.state;
  if (state.system !== 'STOPPED' && state.system !== 'ERROR') {
    if (local === 'SPEAKING') return 'speaking';
    if (local === 'THINKING') return 'thinking';
    if (local === 'LISTENING') return 'listening';
    if (local === 'WAITING') return 'idle';
  }
  if (state.system === 'STOPPED') return 'stopped';
  if (state.system === 'ERROR' || state.identity === 'REJECTED') return 'warning';
  if (state.voice === 'SPEAKING' || state.speechOutput?.state === 'PLAYING') return 'speaking';
  if (state.voice === 'LISTENING') return 'listening';
  if (state.voice === 'THINKING' || state.voice === 'TRANSCRIBING' || state.system === 'BUSY') return 'thinking';
  if (state.conversation === 'WAKE') return 'wake';
  return success ? 'success' : 'idle';
}
export const presenceProfiles: Record<PresenceMode, { speed: number; energy: number; pink: number; blue: number }> = {
  idle: { speed: .12, energy: .5, pink: .35, blue: .45 },
  wake: { speed: .5, energy: .85, pink: .2, blue: .9 },
  listening: { speed: .3, energy: .8, pink: .1, blue: 1 },
  thinking: { speed: .65, energy: .9, pink: 1, blue: .3 },
  speaking: { speed: .7, energy: 1, pink: .7, blue: 1 },
  success: { speed: .25, energy: 1.25, pink: 1, blue: .6 },
  warning: { speed: .08, energy: .7, pink: 1, blue: .1 },
  stopped: { speed: 0, energy: .2, pink: .2, blue: .2 },
  offline: { speed: 0, energy: .15, pink: .2, blue: .3 }
};

/** Prefer voice and tool processing to continuous decorative rendering. */
export function processingVisualBudget(state:{system:string;audio?:{state:string};speechOutput?:{state:string}}|null):boolean{
 return !!state&&(state.system==='BUSY'||['STARTING','READY','CAPTURING','STOPPING'].includes(state.audio?.state??'')||['PREPARING','STARTING','STREAMING','PLAYING'].includes(state.speechOutput?.state??''));
}
