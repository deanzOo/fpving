import { runApp } from "./app/run.js";

await runApp({
  env: process.env,
  overrides: {},
  events: process,
  exit: (code) => process.exit(code),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
