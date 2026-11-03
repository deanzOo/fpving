import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toFailure } from "./client.ts";
import { explain } from "./refusal.tsx";
import { Button, ButtonVariant } from "./ui/button.tsx";
import { Notice, NoticeTone } from "./ui/notice.tsx";
import { TextField } from "./ui/text-field.tsx";

interface UrlFormProps<T> {
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly send: (url: string) => Promise<T>;
  readonly done: (added: T) => Promise<void>;
  readonly said: (added: T) => string;
}

/**
 * A labelled store URL field with its submit button. A refusal is explained in a notice under the field, which it
 * describes, linking to the product that already watches the page when that is the reason.
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
      <div className="min-w-72 flex-1">
        <TextField
          label="Store URL"
          type="url"
          required
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
          placeholder="https://"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
        />
      </div>
      <Button type="submit" variant={ButtonVariant.Primary} pending={added.isPending} pendingLabel={pendingLabel}>
        {submitLabel}
      </Button>
      {error !== null && (
        <div className="w-full">
          <Notice tone={NoticeTone.Critical} id={errorId}>{error}</Notice>
        </div>
      )}
      <p role="status" className="w-full text-ink-muted type-small">{added.isSuccess ? said(added.data) : ""}</p>
    </form>
  );
};
