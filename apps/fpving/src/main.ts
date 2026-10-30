import { ExitCode, handleShutdown } from "./app/lifecycle.js";
import { startApp } from "./app/start.js";

const started = await startApp(process.env);
if (started.ok) {
  const app = started.value;
  handleShutdown({ source: process, shutdown: app.shutdown, logger: app.logger, exit: (code) => process.exit(code) });
  process.stdout.write(`fpving listening on ${app.address}\n`);
} else {
  process.stderr.write(`fpving did not start: ${started.error.message}\n`);
  process.exit(ExitCode.Failed);
}
