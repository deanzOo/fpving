import { useQueryClient } from "@tanstack/react-query";
import { useClient } from "./client.ts";
import { QueryKey } from "./queries.ts";
import { UrlForm } from "./url-form.tsx";

/**
 * The form that starts watching the product behind a pasted store URL.
 *
 * @returns The form.
 */
export const AddProduct = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  return (
    <UrlForm
      submitLabel="Add product"
      pendingLabel="Adding…"
      send={async (url) => client.addProduct({ url })}
      done={async () => queryClient.invalidateQueries({ queryKey: QueryKey.Watchlist })}
      said={({ product }) => `Now watching ${product.name}`}
    />
  );
};
