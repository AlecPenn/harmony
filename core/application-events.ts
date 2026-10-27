import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { applicationEventNames } from '../packages/contracts/events.ts';
import type { ApplicationEvent, ApplicationEventName, ApplicationPayloads, TurnContext } from '../packages/contracts/events.ts';

export class ApplicationEventBus {
  #listeners = new Set<(event: ApplicationEvent) => void>();
  #turns = new Set<TurnContext>();
  #queue: ApplicationEvent[] = [];
  #dispatching = false;
  #sequence = 0;
  #generation = 0;
  #observerFailures = 0;
  #droppedEvents = 0;
  get diagnostics() { return { observerFailures: this.#observerFailures, droppedEvents: this.#droppedEvents }; }
  subscribe(listener: (event: ApplicationEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  beginTurn(): TurnContext {
    if (this.#turns.size >= 64) throw new Error('Too many active turns');
    const turn = Object.freeze({ id: randomUUID(), generation: this.#generation });
    this.#turns.add(turn);
    return turn;
  }
  isCurrent(turn: TurnContext): boolean { return this.#turns.has(turn) && turn.generation === this.#generation; }
  endTurn(turn: TurnContext): void { this.#turns.delete(turn); }
  cancelAll(): void { this.#generation++; this.#turns.clear(); }
  emit<K extends ApplicationEventName>(type: K, payload: ApplicationPayloads[K], turn?: TurnContext): boolean {
    if (!applicationEventNames.includes(type)) throw new Error('Unknown application event');
    if (turn && (!this.#turns.has(turn) || turn.generation !== this.#generation)) return false;
    if (this.#queue.length >= 1024) { this.#droppedEvents++; return false; }
    this.#queue.push({ type, payload: structuredClone(payload), sequence: ++this.#sequence,
      time: new Date().toISOString(), monotonicMs: performance.now(),
      turnId: turn?.id ?? null, generation: this.#generation } as ApplicationEvent);
    if (this.#dispatching) return true;
    this.#dispatching = true;
    let delivered = 0;
    try {
      while (this.#queue.length) {
        // Bound feedback loops as well as queue growth. Producers must not use this as a token buffer.
        if (++delivered > 4096) { this.#droppedEvents += this.#queue.length; this.#queue = []; break; }
        const event = this.#queue.shift()!;
        if (event.turnId && event.generation !== this.#generation) continue;
        for (const listener of [...this.#listeners]) {
          if (event.turnId && event.generation !== this.#generation) break;
          try {
            const result = listener(structuredClone(event));
            // Async observers may finish later; their failures still must not become unhandled rejections.
            Promise.resolve(result).catch(() => { this.#observerFailures++; });
          } catch { this.#observerFailures++; }
        }
      }
    } finally { this.#dispatching = false; }
    return true;
  }
}
