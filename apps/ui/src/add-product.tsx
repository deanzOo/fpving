import { ApiErrorKind } from "@fpving/app/errors";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toFailure, useClient } from "./client.ts";
import type { ApiFailure } from "./client.ts";
import { QueryKey } from "./queries.ts";

const refusal = (failure: ApiFailure, url: string): string => {
  switch (failure.kind) {
    case ApiErrorKind.NoPluginForDomain:
      return `No installed plugin handles ${new URL(url).hostname}. List one in plugins.json, then check Plugins.`;
    case ApiErrorKind.PluginUnavailable:
      return "The plugin for this store is installed but not loaded. Check Plugins.";
    case ApiErrorKind.AlreadyTracked:
      return `This page is already watched: ${failure.message}.`;
    case ApiErrorKind.Restarting:
      return "fpving is restarting its plugins for a settings change. Try again in a moment.";
    default:
      return failure.message;
  }
};

/**
 * The form that starts watching the product behind a pasted store URL. A refusal is explained next to the field.
 *
 * @returns The form.
 */
export const AddProduct = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const errorId = useId();
  const added = useMutation({
    mutationFn: async (pasted: string) => client.addProduct({ url: pasted }),
    onSuccess: async () => {
      setUrl("");
      await queryClient.invalidateQueries({ queryKey: QueryKey.Watchlist });
    },
  });
  const error = added.isError ? refusal(toFailure(added.error), added.variables) : null;
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
        {added.isPending ? "Adding…" : "Add product"}
      </button>
      {error !== null && <p id={errorId} role="alert" className="w-full text-critical">{error}</p>}
      {added.isSuccess && <p role="status" className="w-full text-ink-muted">Now watching {added.data.product.name}</p>}
    </form>
  );
};
