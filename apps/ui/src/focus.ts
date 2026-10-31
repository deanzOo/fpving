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
