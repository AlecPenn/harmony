import type { RuntimeState, WorkerState } from './index.ts';

// Internal trusted-producer contracts, not permission grants or an IPC decoder.
export interface ApplicationPayloads {
  APP_STARTED: undefined;
  APP_READY: undefined;
  APP_FAILED: undefined;
  HEALTH_STARTED: undefined;
  HEALTH_PASSED: undefined;
  HEALTH_FAILED: undefined;
  STOP_REQUESTED: undefined;
  WORK_STOPPED: undefined;
  STATE_CHANGED: RuntimeState;
  WORKER_CHANGED: { state: WorkerState };
  AUDIO_CHANGED: { state: import('./audio.ts').AudioStatus['state'] };
  VOICE_OUTPUT_CHANGED: { state: import('./voice-output.ts').VoiceOutputStatus['state'] };
  WAKE_HEARD: { confidence: number };
  SPEAKER_DETECTED: { candidateId: string; confidence: number };
  IDENTITY_VERIFIED: { personId: string };
  IDENTITY_REJECTED: { reason: 'unknown' | 'uncertain' | 'denied' };
  USER_SPEAKING: undefined;
  USER_STOPPED_SPEAKING: undefined;
  TRANSCRIPT_READY: { text: string; final: boolean; segment: number };
  AI_STARTED: { routeId: string };
  AI_TOKEN: { text: string; segment: number };
  TOOL_STARTED: { actionId: string; toolId: string };
  TOOL_FINISHED: { actionId: string; verified: boolean };
  TOOL_FAILED: { actionId: string; reason: 'failed' | 'cancelled' | 'denied' };
  REPLY_STARTED: undefined;
  REPLY_FINISHED: undefined;
  REMINDER_DUE: { reminderId: string };
  CALENDAR_UPCOMING: { eventId: string };
  PROJECT_CHANGED: { projectId: string };
  SCREEN_CAPTURED: { artifactId: string };
}
export type ApplicationEventName = keyof ApplicationPayloads;
export type ApplicationEvent = {
  [K in ApplicationEventName]: {
    type: K; payload: ApplicationPayloads[K]; sequence: number;
    time: string; monotonicMs: number; turnId: string | null; generation: number;
  }
}[ApplicationEventName];
export interface TurnContext { readonly id: string; readonly generation: number }

export const applicationEventNames: readonly ApplicationEventName[] = [
  'APP_STARTED', 'APP_READY', 'APP_FAILED', 'HEALTH_STARTED', 'HEALTH_PASSED', 'HEALTH_FAILED',
  'STOP_REQUESTED', 'WORK_STOPPED', 'STATE_CHANGED', 'WORKER_CHANGED', 'AUDIO_CHANGED', 'VOICE_OUTPUT_CHANGED', 'WAKE_HEARD',
  'SPEAKER_DETECTED', 'IDENTITY_VERIFIED', 'IDENTITY_REJECTED', 'USER_SPEAKING',
  'USER_STOPPED_SPEAKING', 'TRANSCRIPT_READY', 'AI_STARTED', 'AI_TOKEN', 'TOOL_STARTED',
  'TOOL_FINISHED', 'TOOL_FAILED', 'REPLY_STARTED', 'REPLY_FINISHED', 'REMINDER_DUE',
  'CALENDAR_UPCOMING', 'PROJECT_CHANGED', 'SCREEN_CAPTURED'
];
