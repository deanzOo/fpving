import { useId, useRef } from "react";
import { Button, ButtonVariant } from "./button.tsx";

interface ConfirmProps {
  readonly action: string;
  readonly actionLabel?: string;
  readonly question: string;
  readonly confirm: string;
  readonly pending: boolean;
  readonly onConfirm: () => void;
}

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
      <Button
        pending={pending}
        aria-label={actionLabel}
        onClick={() => {
          dialog.current?.showModal();
        }}
      >
        {action}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={questionId}
        className={"m-auto max-w-[420px] rounded-2 border border-line-strong bg-surface-raised p-6 text-ink "
          + "shadow-dialog backdrop:bg-scrim"}
      >
        <p id={questionId} className="type-body">{question}</p>
        <form method="dialog" className="mt-4 flex gap-2">
          <Button type="submit" autoFocus>Cancel</Button>
          <Button
            variant={ButtonVariant.Danger}
            onClick={() => {
              dialog.current?.close();
              onConfirm();
            }}
          >
            {confirm}
          </Button>
        </form>
      </dialog>
    </>
  );
};
