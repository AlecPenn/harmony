export class EventBus<T> {
  #listeners = new Set<(value: T) => void>();
  subscribe(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  publish(value: T): void {
    // Observers cannot mutate another observer's view or break the runtime.
    for (const listener of this.#listeners) {
      try { listener(structuredClone(value)); } catch { /* UI observer failure is isolated. */ }
    }
  }
}
