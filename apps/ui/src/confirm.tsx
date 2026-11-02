import { useId, useRef } from "react";
import { unlessPending } from "./pending.ts";

interface ConfirmProps {
  readonly action: string;
  readonly actionLabel?: string;
  readonly question: string;
  readonly confirm: string;
  readonly pending: boolean;
  readonly onConfirm: () => void;
}

const button = "rounded-md border border-line px-3 py-1 font-medium aria-disabled:opacity-60";

/**
 * A button that asks first in a modal dialog. Cancel, or Escape, closes it and the browser puts focus back on the
 * button; the confirm button closes it and runs `onConfirm`. While `pending` the button stays focusable but does
 * nothing.
 *
 * @param props - The button's text and accessible name, the question, the confirm button's text and the action.
 * @returns The button and its dialog.
 */
export const Confirm = ({ action, actionLabel, question, confirm, pending, onConfirm }: ConfirmProps) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const questionId = useId();
  return (
    <>
      <button
        type="button"
        className={button}
        aria-disabled={pending}
        aria-label={actionLabel}
        onClick={unlessPending(pending, () => {
          dialog.current?.showModal();
        })}
      >
        {action}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={questionId}
        className="m-auto rounded-lg border border-line bg-surface p-6 text-ink backdrop:bg-ink/40"
      >
        <p id={questionId}>{question}</p>
        <form method="dialog" className="mt-4 flex gap-2">
          <button type="submit" className={button} autoFocus>Cancel</button>
          <button
            type="button"
            className="rounded-md bg-critical px-3 py-1 font-medium text-on-critical"
            onClick={() => {
              dialog.current?.close();
              onConfirm();
            }}
          >
            {confirm}
          </button>
        </form>
      </dialog>
    </>
  );
};
