import { useEffect, useRef, useState } from "react";

/**
 * Moves focus after an item of a list went away: to the item now in its place, else the list's last item, else
 * `fallback`, such as the list's heading, when the list holds nothing.
 *
 * @param list - The list, whose `li` children can take focus.
 * @param index - Where the item was.
 * @param fallback - What takes focus when the list holds nothing.
 */
export const focusAfterRemoval = (list: Element | null, index: number, fallback: HTMLElement | null): void => {
  const items = list === null ? [] : [...list.querySelectorAll<HTMLElement>(":scope > li")];
  (items[index] ?? items.at(-1) ?? fallback)?.focus();
};

/** The item an action works on and where it sits in its list. */
export interface FocusTarget {
  readonly id: string;
  readonly index: number;
}

/**
 * Focus management for a list whose action can take an item out of it. `track` an item when the action starts and
 * pass null when it fails; once `pending(id)` says the item is done, focus moves as {@link focusAfterRemoval} moves
 * it, between the list and its heading.
 *
 * @param pending - Whether the item with this id is still waiting for the action.
 * @returns The list and heading refs and `track`.
 */
export const useFocusAfterRemoval = (pending: (id: string) => boolean) => {
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [target, track] = useState<FocusTarget | null>(null);
  useEffect(() => {
    if (target !== null && !pending(target.id)) {
      focusAfterRemoval(list.current, target.index, heading.current);
      track(null);
    }
  });
  return { list, heading, track };
};
