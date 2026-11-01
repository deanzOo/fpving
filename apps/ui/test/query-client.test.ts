import { ApiErrorKind } from "@fpving/app/errors";
import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ApiFailure, ClientErrorKind } from "../src/client.ts";
import type { FailureKind } from "../src/client.ts";
import { createQueryClient, READ_RETRIES } from "../src/query-client.ts";

const callsFor = async (kind: FailureKind): Promise<number> => {
  let calls = 0;
  const observer = new QueryObserver(createQueryClient({ retryDelay: 0 }), {
    queryKey: [kind],
    queryFn: async () => {
      calls += 1;
      return Promise.reject(new ApiFailure(kind, kind));
    },
  });
  await new Promise<void>((resolve) => {
    const stop = observer.subscribe(({ isError }) => {
      if (isError) {
        stop();
        resolve();
      }
    });
  });
  return calls;
};

describe("Retrying reads", () => {
  it.each([ClientErrorKind.Unreachable, ApiErrorKind.Starting])(
    "tries a %s read again a bounded number of times, since it can pass once fpving is up",
    async (kind) => {
      expect(await callsFor(kind)).toBe(READ_RETRIES + 1);
    },
  );

  it.each([ApiErrorKind.NotFound, ApiErrorKind.ProductNotFound, ClientErrorKind.BadResponse, ApiErrorKind.Internal])(
    "never tries a %s read again, since the answer would not change",
    async (kind) => {
      expect(await callsFor(kind)).toBe(1);
    },
  );
});
