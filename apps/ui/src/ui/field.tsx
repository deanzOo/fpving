import { useId } from "react";
import type { AriaAttributes, ReactNode } from "react";

/** What a form control can say under itself: a hint, or an error that replaces it. */
export interface Described {
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
}

const BOX = "w-full rounded-1 border border-line-strong bg-page px-3 text-ink focus:border-signal "
  + "aria-invalid:border-critical";

/** The classes a text input and a select share, but the face: on `page`, a strong border, critical when invalid. */
export const CONTROL = `h-(--control-height) ${BOX}`;

/** The classes of a multi-line text box: the control's look, a few lines tall and taller on demand. */
export const AREA = `min-h-24 resize-y py-2 ${BOX}`;

/**
 * Ties a control to its hint or error: the attributes the control takes and the line to show under it.
 * Without a hint or an error, an `aria-describedby` and `aria-invalid` given here stand, for a message shown
 * elsewhere such as a refusal notice.
 *
 * @param described - The hint, the error and any `aria-describedby` and `aria-invalid` from the caller.
 * @returns The control's `aria-describedby` and `aria-invalid`, and the description line.
 */
export const useDescription = ({
  hint,
  error,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: Described & Pick<AriaAttributes, "aria-describedby" | "aria-invalid">) => {
  const id = useId();
  const shown = error ?? hint;
  const description = error === undefined
    ? <span id={id} className="type-small text-ink-muted">{hint}</span>
    : (
        <span id={id} className="type-small text-critical">
          <span aria-hidden="true" className="type-code">✕ </span>
          {error}
        </span>
      );
  return {
    control: {
      "aria-describedby": shown === undefined ? describedBy : id,
      "aria-invalid": error === undefined ? invalid : true,
    },
    description: shown === undefined ? null : description,
  };
};

/**
 * A labelled control above its description line, for TextField and Select.
 *
 * @param props - The label, the control's id, the frame's extra classes, the control and its description line.
 * @returns The field.
 */
export const Field = ({ label, id, frame = "", children, description }: {
  readonly label: ReactNode;
  readonly id: string;
  readonly frame?: string;
  readonly children: ReactNode;
  readonly description: ReactNode;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={id} className="type-control text-ink">{label}</label>
    <span className={`focus-frame relative flex ${frame}`}>{children}</span>
    {description}
  </div>
);
