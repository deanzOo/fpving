import "./zod-config.ts";
import { createBrowserHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { browserClient } from "./client.ts";
import { createQueryClient } from "./query-client.ts";
import "./styles.css";
import { applyTheme, readTheme } from "./ui/theme.ts";

applyTheme(readTheme());

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element");
}
createRoot(container).render(
  <StrictMode>
    <App client={browserClient} queryClient={createQueryClient()} history={createBrowserHistory()} />
  </StrictMode>,
);
