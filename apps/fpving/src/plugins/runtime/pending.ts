/** Requests waiting for an answer, keyed by a per-direction id. */
export interface Pending<T> {
  /** Opens a request: its id, and a promise that resolves when it is settled. */
  open(): { readonly id: number; readonly result: Promise<T> };
  /** Settles one open request; false when the id is unknown or already settled. */
  settle(id: number, value: T): boolean;
  /** Settles every open request with the same value. */
  settleAll(value: T): void;
}

/** Creates an empty {@link Pending} whose ids count up from 0. */
export const createPending = <T>(): Pending<T> => {
  let nextId = 0;
  const waiting = new Map<number, (value: T) => void>();
  return {
    open: () => {
      const id = nextId;
      nextId += 1;
      return { id, result: new Promise<T>((resolve) => waiting.set(id, resolve)) };
    },
    settle: (id, value) => {
      const resolve = waiting.get(id);
      waiting.delete(id);
      resolve?.(value);
      return resolve !== undefined;
    },
    settleAll: (value) => {
      const all = [...waiting.values()];
      waiting.clear();
      all.forEach((resolve) => {
        resolve(value);
      });
    },
  };
};
