import { inspect } from "node:util";
import { ExitCode, handleShutdown } from "./app/lifecycle.js";
import { startApp } from "./app/start.js";

const started = await startApp(process.env);
if (started.ok) {
  const app = started.value;
  handleShutdown({ source: process, shutdown: app.shutdown, logger: app.logger, exit: (code) => process.exit(code) });
  try {
    const address = await app.listen();
    app.logger.info("listening", { address });
    process.stdout.write(`fpving listening on ${address}\n`);
  } catch (error) {
    app.logger.error("could not listen", { detail: inspect(error) });
    process.stderr.write(`fpving could not listen on 127.0.0.1:${String(app.env.PORT)}: ${String(error)}\n`);
    await app.shutdown();
    process.exit(ExitCode.Failed);
  }
} else {
  process.stderr.write(`fpving did not start: ${started.error.message}\n`);
  process.exitCode = ExitCode.Failed;
}
