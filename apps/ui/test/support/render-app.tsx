import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "vitest-browser-react";
import { App } from "../../src/app.tsx";
import type { Client } from "../../src/client.ts";
import { createQueryClient } from "../../src/query-client.ts";

/**
 * Renders the whole app at `path` over `client` and the app's query client, with no delay before a retry; the query
 * cache comes back with it.
 */
export const renderApp = async (client: Client, path = "/") => {
  const queryClient = createQueryClient({ retryDelay: 0 });
  const history = createMemoryHistory({ initialEntries: [path] });
  const screen = await render(<App client={client} queryClient={queryClient} history={history} />);
  return Object.assign(screen, { queryClient });
};
