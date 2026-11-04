import { beforeEach } from "vitest";
import { userEvent } from "vitest/browser";

beforeEach(async () => {
  await userEvent.unhover(document.body);
});
