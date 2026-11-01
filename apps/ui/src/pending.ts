/**
 * An activation handler for a control that is unavailable while `pending`. The control is marked `aria-disabled`
 * rather than `disabled`, so it keeps focus through a request and after a failure; this handler ignores it meanwhile.
 *
 * @param pending - Whether the request the control starts is running.
 * @param act - What the control does.
 * @returns The click or submit handler.
 */
export const unlessPending = (pending: boolean, act: () => void) => (event: { preventDefault(): void }): void => {
  event.preventDefault();
  if (!pending) {
    act();
  }
};
