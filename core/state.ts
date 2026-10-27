import type { SystemState, RuntimeState, VoiceState, IdentityState, ConversationState, FocusState } from '../packages/contracts/index.ts';
import { EventBus } from './events.ts';
const transitions: Record<SystemState, readonly SystemState[]> = {
  OFF: ['BOOTING'],
  BOOTING: ['PASSIVE', 'ERROR', 'STOPPED'],
  PASSIVE: ['ACTIVE', 'BUSY', 'STOPPED', 'ERROR'],
  ACTIVE: ['PASSIVE', 'BUSY', 'STOPPED', 'ERROR'],
  BUSY: ['PASSIVE', 'ACTIVE', 'STOPPED', 'ERROR'],
  ERROR: ['BOOTING', 'STOPPED'],
  STOPPED: ['BOOTING']
};
export class StateEngine {
  readonly changes = new EventBus<RuntimeState>();
  #state: RuntimeState = { system: 'OFF', voice: 'DISABLED', identity: 'UNKNOWN', conversation: 'NONE', focus: 'NORMAL' };
  get value() { return this.#state.system; }
  snapshot(): RuntimeState { return structuredClone(this.#state); }
  #commit(next: RuntimeState): void { this.#state = next; this.changes.publish(next); }
  transition(next: SystemState): void {
    if (!transitions[this.value].includes(next)) throw new Error(`Invalid transition: ${this.value} → ${next}`);
    if (['STOPPED', 'ERROR', 'BOOTING', 'PASSIVE'].includes(next)) {
      this.#commit({ ...this.#state, system: next, voice: 'DISABLED', identity: 'UNKNOWN', conversation: 'NONE' });
    } else this.#commit({ ...this.#state, system: next });
  }
  setFocus(next: FocusState): void {
    if (!['NORMAL', 'FOCUS', 'CREATIVE', 'MEETING', 'GHOST', 'NIGHT'].includes(next)) throw new Error('Invalid focus state');
    this.#commit({ ...this.#state, focus: next });
  }
  #requireRunning() {
    if (!['PASSIVE', 'ACTIVE', 'BUSY'].includes(this.value)) throw new Error('Runtime is not accepting session transitions');
  }
  transitionIdentity(next: IdentityState): void {
    this.#requireRunning();
    const allowed: Record<IdentityState, IdentityState[]> = {
      UNKNOWN: ['DETECTING'], DETECTING: ['AUTHORIZED', 'UNCERTAIN', 'REJECTED', 'UNKNOWN'],
      UNCERTAIN: ['DETECTING', 'AUTHORIZED', 'REJECTED', 'UNKNOWN'], AUTHORIZED: ['UNKNOWN', 'DETECTING'], REJECTED: ['UNKNOWN', 'DETECTING']
    };
    if (!allowed[this.#state.identity].includes(next)) throw new Error('Invalid identity transition');
    const state = { ...this.#state, identity: next };
    // Losing a verified identity tears down conversation and voice atomically.
    if (next !== 'AUTHORIZED') { state.conversation = 'NONE'; state.voice = 'DISABLED'; }
    this.#commit(state);
  }
  transitionConversation(next: ConversationState): void {
    this.#requireRunning();
    const allowed: Record<ConversationState, ConversationState[]> = {
      NONE: ['WAKE'], WAKE: ['ACTIVE', 'ENDING', 'NONE'], ACTIVE: ['FOLLOWUP', 'ENDING'], FOLLOWUP: ['ACTIVE', 'ENDING'], ENDING: ['NONE']
    };
    if (!allowed[this.#state.conversation].includes(next)) throw new Error('Invalid conversation transition');
    if (next !== 'NONE' && this.#state.identity !== 'AUTHORIZED') throw new Error('Conversation requires verified identity');
    const state = { ...this.#state, conversation: next };
    if (next === 'NONE') state.voice = 'DISABLED';
    this.#commit(state);
  }
  transitionVoice(next: VoiceState): void {
    this.#requireRunning();
    const allowed: Record<VoiceState, VoiceState[]> = {
      DISABLED: ['WAKE_ONLY'], WAKE_ONLY: ['LISTENING', 'DISABLED'], LISTENING: ['TRANSCRIBING', 'INTERRUPTED', 'DISABLED'],
      TRANSCRIBING: ['THINKING', 'INTERRUPTED', 'DISABLED'], THINKING: ['SPEAKING', 'LISTENING', 'INTERRUPTED', 'DISABLED'],
      SPEAKING: ['INTERRUPTED', 'WAKE_ONLY', 'LISTENING', 'DISABLED'], INTERRUPTED: ['LISTENING', 'WAKE_ONLY', 'DISABLED']
    };
    if (!allowed[this.#state.voice].includes(next)) throw new Error('Invalid voice transition');
    if (!['DISABLED', 'WAKE_ONLY'].includes(next) && (this.#state.identity !== 'AUTHORIZED' || this.#state.conversation === 'NONE')) throw new Error('Active voice requires an authorized conversation');
    this.#commit({ ...this.#state, voice: next });
  }
}
