import { useId } from "react";
import type { ReactNode } from "react";

/** What a form control can say under itself: a hint, or an error that replaces it. */
export interface Described {
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
}

/** The classes a text input and a select share, but the face: on `page`, a strong border, critical when invalid. */
export const CONTROL = "h-(--control-height) w-full rounded-1 border border-line-strong bg-page px-3 text-ink "
  + "focus:border-signal aria-invalid:border-critical";

/**
 * Ties a control to its hint or error: the attributes the control takes and the line to show under it.
 *
 * @param described - The hint and the error.
 * @returns The control's `aria-describedby` and `aria-invalid`, and the description line.
 */
export const useDescription = ({ hint, error }: Described) => {
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
      "aria-describedby": shown === undefined ? undefined : id,
      "aria-invalid": error === undefined ? undefined : true,
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
    <span className={`focus-frame flex ${frame}`}>{children}</span>
    {description}
  </div>
);
