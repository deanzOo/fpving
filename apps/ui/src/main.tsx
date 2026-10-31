import "./zod-config.ts";
import { createBrowserHistory } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { browserClient } from "./client.ts";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element");
}
createRoot(container).render(
  <StrictMode>
    <App client={browserClient} queryClient={new QueryClient()} history={createBrowserHistory()} />
  </StrictMode>,
);
