import { describe, expect, it } from "vitest";
import { focusAfterRemoval } from "../src/focus.ts";

const TWO = 2;

const listOf = (count: number) => {
  const list = document.createElement("ul");
  for (let index = 0; index < count; index += 1) {
    const item = document.createElement("li");
    item.tabIndex = -1;
    list.append(item);
  }
  document.body.append(list);
  return list;
};

describe("Focus after a list item went away", () => {
  it("focuses the item that took the removed one's place", () => {
    const list = listOf(TWO);
    focusAfterRemoval(list, 1, null);
    expect(document.activeElement).toBe(list.children[1]);
    list.remove();
  });

  it("focuses the last item when the removed one was last", () => {
    const list = listOf(TWO);
    focusAfterRemoval(list, TWO, null);
    expect(document.activeElement).toBe(list.children[1]);
    list.remove();
  });

  it("focuses the fallback when the list is empty or gone", () => {
    const fallback = document.createElement("h2");
    fallback.tabIndex = -1;
    document.body.append(fallback);
    focusAfterRemoval(listOf(0), 0, fallback);
    expect(document.activeElement).toBe(fallback);
    fallback.blur();
    focusAfterRemoval(null, 0, fallback);
    expect(document.activeElement).toBe(fallback);
    focusAfterRemoval(null, 0, null);
    fallback.remove();
  });
});
