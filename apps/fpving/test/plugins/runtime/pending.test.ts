import { describe, expect, it } from "vitest";
import { createPending } from "../../../src/plugins/runtime/pending.ts";

describe("Pending request bookkeeping", () => {
  it("gives each request its own id and resolves it with the value it is settled with", async () => {
    const pending = createPending<string>();
    const first = pending.open();
    const second = pending.open();
    expect(second.id).not.toBe(first.id);
    expect(pending.settle(second.id, "b")).toBe(true);
    expect(pending.settle(first.id, "a")).toBe(true);
    expect(await Promise.all([first.result, second.result])).toEqual(["a", "b"]);
  });

  it("ignores an unknown id and a request settled twice", async () => {
    const pending = createPending<string>();
    const request = pending.open();
    expect(pending.settle(request.id + 1, "x")).toBe(false);
    pending.settle(request.id, "first");
    expect(pending.settle(request.id, "second")).toBe(false);
    expect(await request.result).toBe("first");
  });

  it("settles every open request at once, so none is left hanging", async () => {
    const pending = createPending<string>();
    const requests = [pending.open(), pending.open()];
    pending.settleAll("stopped");
    expect(await Promise.all(requests.map(({ result }) => result))).toEqual(["stopped", "stopped"]);
    expect(pending.settle(requests[0]?.id ?? -1, "late")).toBe(false);
  });
});
