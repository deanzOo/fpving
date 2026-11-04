// Runs render-blocking in <head>, before the stylesheet, so a stored theme applies before the first frame.
try {
  const theme = globalThis.localStorage.getItem("fpving.theme");
  if (theme === "light" || theme === "dark") {
    globalThis.document.documentElement.dataset["theme"] = theme;
  }
} catch (error) {
  if (!(error instanceof DOMException)) {
    throw error;
  }
}
