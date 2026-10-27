import { test } from 'vitest';
import assert from 'node:assert/strict';
import { StateEngine } from '../core/state.ts';

test('all five state axes are centrally owned and returned by value', () => {
  const engine = new StateEngine();
  const copy = engine.snapshot(); copy.identity = 'AUTHORIZED';
  assert.deepEqual(engine.snapshot(), { system: 'OFF', voice: 'DISABLED', identity: 'UNKNOWN', conversation: 'NONE', focus: 'NORMAL' });
  engine.transition('BOOTING'); engine.transition('PASSIVE'); engine.transition('ACTIVE');
  engine.setFocus('MEETING');
  assert.equal(engine.snapshot().system, 'ACTIVE');
  assert.equal(engine.snapshot().focus, 'MEETING');
});
test('unknown and rejected identities cannot open a conversation or active voice', () => {
  const engine = new StateEngine(); engine.transition('BOOTING'); engine.transition('PASSIVE');
  assert.throws(() => engine.transitionIdentity('AUTHORIZED'));
  assert.throws(() => engine.transitionConversation('WAKE'), /verified/);
  engine.transitionVoice('WAKE_ONLY');
  assert.throws(() => engine.transitionVoice('LISTENING'), /authorized/);
  engine.transitionIdentity('DETECTING'); engine.transitionIdentity('REJECTED');
  assert.equal(engine.snapshot().voice, 'DISABLED');
  assert.throws(() => engine.transitionConversation('WAKE'), /verified/);
});
test('STOP atomically clears session states and stale callbacks cannot restore them', () => {
  const engine = new StateEngine(); engine.transition('BOOTING'); engine.transition('PASSIVE');
  engine.transitionIdentity('DETECTING'); engine.transitionIdentity('AUTHORIZED');
  engine.transitionConversation('WAKE'); engine.transitionConversation('ACTIVE');
  engine.transitionVoice('WAKE_ONLY'); engine.transitionVoice('LISTENING');
  engine.transitionVoice('TRANSCRIBING'); engine.transitionVoice('THINKING'); engine.transitionVoice('SPEAKING');
  engine.transitionVoice('INTERRUPTED'); engine.transitionVoice('LISTENING');
  engine.setFocus('FOCUS');
  engine.transition('STOPPED');
  assert.deepEqual(engine.snapshot(), { system: 'STOPPED', voice: 'DISABLED', identity: 'UNKNOWN', conversation: 'NONE', focus: 'FOCUS' });
  assert.throws(() => engine.transitionIdentity('DETECTING'), /not accepting/);
  assert.throws(() => engine.transitionVoice('WAKE_ONLY'), /not accepting/);
  engine.transition('BOOTING'); engine.transition('PASSIVE');
  assert.equal(engine.snapshot().conversation, 'NONE');
});
test('identity loss ends the session, and subscriptions observe coherent snapshots', () => {
  const engine = new StateEngine(); const seen: ReturnType<StateEngine['snapshot']>[] = [];
  engine.changes.subscribe(state => seen.push(state));
  engine.transition('BOOTING'); engine.transition('PASSIVE');
  engine.transitionIdentity('DETECTING'); engine.transitionIdentity('UNCERTAIN'); engine.transitionIdentity('AUTHORIZED');
  engine.transitionConversation('WAKE'); engine.transitionConversation('ACTIVE'); engine.transitionConversation('FOLLOWUP');
  engine.transitionIdentity('UNKNOWN');
  const last = seen.at(-1)!;
  assert.equal(last.identity, 'UNKNOWN'); assert.equal(last.conversation, 'NONE'); assert.equal(last.voice, 'DISABLED');
});
