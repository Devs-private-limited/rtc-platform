// Mapped-type constraint so interfaces (like RTCEvents) qualify without an index signature.
type EventMap<Events> = { [K in keyof Events]: unknown[] };

export class EventEmitter<Events extends EventMap<Events> = Record<string, unknown[]>> {
  private listeners = new Map<keyof Events, Set<(...args: unknown[]) => void>>();

  on<K extends keyof Events>(event: K, handler: (...args: Events[K]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: (...args: Events[K]) => void) {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]) {
    for (const handler of this.listeners.get(event) || []) {
      handler(...args);
    }
  }
}
