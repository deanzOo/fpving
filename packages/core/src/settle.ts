/**
 * Waits for every promise to settle, then returns their values in order or throws the first rejection in order.
 * Unlike `Promise.all` it never leaves a sibling running after it rejects.
 *
 * @param promises - The promises to settle.
 * @returns Their values.
 */
export const settleAll = async <T>(promises: readonly Promise<T>[]): Promise<T[]> => {
  const settled = await Promise.allSettled(promises);
  const values: T[] = [];
  for (const row of settled) {
    if (row.status === "rejected") {
      throw row.reason;
    }
    values.push(row.value);
  }
  return values;
};
