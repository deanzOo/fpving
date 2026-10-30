import { registerHooks } from "node:module";

const JS_EXTENSION = ".js";
const TS_EXTENSION = ".ts";

registerHooks({
  resolve: (specifier, context, nextResolve) =>
    context.parentURL?.endsWith(TS_EXTENSION) === true && specifier.startsWith(".") && specifier.endsWith(JS_EXTENSION)
      ? nextResolve(`${specifier.slice(0, -JS_EXTENSION.length)}${TS_EXTENSION}`, context)
      : nextResolve(specifier, context),
});
