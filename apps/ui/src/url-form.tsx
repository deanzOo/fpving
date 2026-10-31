import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toFailure } from "./client.ts";
import { explain } from "./refusal.tsx";

interface UrlFormProps<T> {
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly send: (url: string) => Promise<T>;
  readonly done: (added: T) => Promise<void>;
  readonly said: (added: T) => string;
}

/**
 * A labelled store URL field with its submit button. A refusal is explained next to the field, linking to the
 * product that already watches the page when that is the reason.
 *
 * @param props - What the button says, what a submit sends, what to do once it was added and what to say then.
 * @returns The form.
 */
export const UrlForm = <T extends object>({ submitLabel, pendingLabel, send, done, said }: UrlFormProps<T>) => {
  const [url, setUrl] = useState("");
  const errorId = useId();
  const added = useMutation({
    mutationFn: send,
    onSuccess: async (result) => {
      setUrl("");
      await done(result);
    },
  });
  const error = added.isError ? explain(toFailure(added.error)) : null;
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        added.mutate(url);
      }}
    >
      <label className="flex min-w-72 flex-1 flex-col gap-1">
        <span className="font-medium">Store URL</span>
        <input
          type="url"
          required
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
          placeholder="https://"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          className="rounded-md border border-line bg-surface px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={added.isPending}
        className="rounded-md bg-action px-4 py-2 font-medium text-on-action disabled:opacity-60"
      >
        {added.isPending ? pendingLabel : submitLabel}
      </button>
      {error !== null && <p id={errorId} role="alert" className="w-full text-critical">{error}</p>}
      {added.isSuccess && <p role="status" className="w-full text-ink-muted">{said(added.data)}</p>}
    </form>
  );
};
