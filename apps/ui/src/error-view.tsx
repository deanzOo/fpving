import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { toFailure } from "./client.ts";
import { explain } from "./refusal.tsx";
import { Button, ButtonVariant } from "./ui/button.tsx";
import { Notice, NoticeTone } from "./ui/notice.tsx";

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
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4">
      <h1 className="type-title">Something went wrong</h1>
      <Notice tone={NoticeTone.Critical} tag="Failed">
        <span>{explain(failure)}</span>
        {" "}
        <span className="text-ink-muted">
          Error kind: <code className="type-code">{failure.kind}</code>
        </span>
      </Notice>
      <Button
        variant={ButtonVariant.Primary}
        onClick={() => {
          queries.reset();
          reset();
        }}
      >
        Try again
      </Button>
    </section>
  );
};
