/** Runs a task repeatedly. */
export interface Scheduler {
  /**
   * Runs `task` first after `firstDelayMs` milliseconds, then every `intervalMs` milliseconds, and returns a function
   * that stops it. `task` must not reject.
   */
  every(intervalMs: number, task: () => Promise<void>, firstDelayMs: number): () => void;
}
