import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { toFailure } from "./client.ts";
import { explain } from "./refusal.tsx";

/**
 * The one error boundary's view: what failed, with the error kind, and a retry.
 *
 * @param props - The error and the boundary's reset.
 * @returns The error view.
 */
export const ErrorView = ({ error, reset }: Pick<ErrorComponentProps, "error" | "reset">) => {
  const queries = useQueryErrorResetBoundary();
  const failure = toFailure(error);
  return (
    <section role="alert" className="mx-auto max-w-xl rounded-lg border border-line bg-surface p-6">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2">{explain(failure)}</p>
      <p className="mt-2 text-sm text-ink-muted">
        Error kind: <code>{failure.kind}</code>
      </p>
      <button
        type="button"
        className="mt-4 rounded-md bg-signal px-4 py-2 font-medium text-on-signal"
        onClick={() => {
          queries.reset();
          reset();
        }}
      >
        Try again
      </button>
    </section>
  );
};
