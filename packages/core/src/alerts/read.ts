import type { CoreDeps } from "../products/add.js";

/**
 * Marks every unread alert read now, in one step.
 *
 * @param deps - The repository and the clock.
 * @returns How many alerts were unread.
 */
export const markAllAlertsRead = async (
  { repository, clock }: Pick<CoreDeps, "repository" | "clock">,
): Promise<number> => repository.alerts.markAllRead(clock.now());
