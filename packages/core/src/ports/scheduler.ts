/** Runs a task repeatedly. */
export interface Scheduler {
  /**
   * Runs `task` every `intervalMs` milliseconds, first after one interval, and returns a function that stops it.
   * `task` must not reject.
   */
  every(intervalMs: number, task: () => Promise<void>): () => void;
}
