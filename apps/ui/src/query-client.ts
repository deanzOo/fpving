import { ApiErrorKind } from "@fpving/app/errors";
import { QueryClient } from "@tanstack/react-query";
import { ClientErrorKind, toFailure } from "./client.ts";
import type { FailureKind } from "./client.ts";

/** How many more times a read that can pass later is tried. */
export const READ_RETRIES = 2;

const PASSING: readonly FailureKind[] = [ClientErrorKind.Unreachable, ApiErrorKind.Starting];

/**
 * The query cache the app and its tests read through. A read is tried again, at most {@link READ_RETRIES} times,
 * only when it failed because fpving was unreachable or still starting; any other failure would answer the same, so
 * it shows at once.
 *
 * @param options - The delay before a retry; the default backs off.
 * @returns The query client.
 */
export const createQueryClient = (options: { readonly retryDelay?: number } = {}): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        ...options,
        retry: (failures, error) => failures < READ_RETRIES && PASSING.includes(toFailure(error).kind),
      },
    },
  });
