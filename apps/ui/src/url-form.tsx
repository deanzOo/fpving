import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toFailure } from "./client.ts";
import { noticeLook, Refused } from "./refusal.tsx";
import { Button, ButtonVariant } from "./ui/button.tsx";
import { Done, NoticeTone } from "./ui/notice.tsx";
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
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        added.mutate(url);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
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
            aria-invalid={added.isError && noticeLook(toFailure(added.error)).tone !== NoticeTone.Warning}
            aria-describedby={added.isError ? errorId : undefined}
          />
        </div>
        <Button type="submit" variant={ButtonVariant.Primary} pending={added.isPending} pendingLabel={pendingLabel}>
          {submitLabel}
        </Button>
      </div>
      <div className="has-[p]:mt-3">
        <Done>{added.isSuccess ? said(added.data) : ""}</Done>
      </div>
      <div className="has-[p]:mt-3">
        <Refused error={added.error} id={errorId} />
      </div>
    </form>
  );
};
