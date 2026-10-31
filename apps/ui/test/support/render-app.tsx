import { createMemoryHistory } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { render } from "vitest-browser-react";
import { App } from "../../src/app.tsx";
import type { Client } from "../../src/client.ts";

/** Renders the whole app at `path` over `client`, with query retries off so failures show at once. */
export const renderApp = async (client: Client, path = "/") => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [path] });
  return render(<App client={client} queryClient={queryClient} history={history} />);
};
