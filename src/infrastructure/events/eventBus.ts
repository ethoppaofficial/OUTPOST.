type Listener<T> = (data: T) => void;

class EventBus {
  private listeners: Map<string, Set<Listener<any>>> = new Map();

  subscribe<T>(channel: string, listener: Listener<T>): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(listener);

    return () => {
      const set = this.listeners.get(channel);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(channel);
        }
      }
    };
  }

  publish<T>(channel: string, data: T): void {
    const set = this.listeners.get(channel);
    if (set) {
      set.forEach((listener) => {
        try {
          listener(data);
        } catch (err) {
          console.error(`Error in event listener for channel ${channel}:`, err);
        }
      });
    }
  }
}

export const appEventBus = new EventBus();
