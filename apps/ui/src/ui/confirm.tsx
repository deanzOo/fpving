import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { Button, ButtonSize, ButtonVariant } from "./button.tsx";

interface ConfirmProps {
  readonly action: string;
  readonly actionLabel?: string;
  readonly question: string;
  readonly confirm: string;
  readonly pending: boolean;
  readonly pendingLabel?: ReactNode;
  readonly size?: (typeof ButtonSize)[keyof typeof ButtonSize];
  readonly onConfirm: () => void;
}

/**
 * A button that asks first in a modal dialog. Cancel, or Escape, closes it and the browser puts focus back on the
 * button; the confirm button closes it and runs `onConfirm`. While `pending` the button stays focusable, shows
 * `pendingLabel` when given and does nothing; `size` makes it small for a table row.
 *
 * @param props - The button's text, name, size and pending text, the question, the confirm text and the action.
 * @returns The button and its dialog.
 */
export const Confirm = ({
  action, actionLabel, question, confirm, pending, pendingLabel, size = ButtonSize.Regular, onConfirm,
}: ConfirmProps) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const questionId = useId();
  return (
    <>
      <Button
        pending={pending}
        pendingLabel={pendingLabel}
        size={size}
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
          + "shadow-(--shadow-dialog) backdrop:bg-scrim"}
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
