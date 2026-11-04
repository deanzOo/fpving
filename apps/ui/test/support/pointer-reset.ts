import { beforeEach } from "vitest";
import { userEvent } from "vitest/browser";

const RESET_TIMEOUT_MS = 8000;

beforeEach(async () => {
  await userEvent.unhover(document.body, { force: true, timeout: RESET_TIMEOUT_MS });
});
