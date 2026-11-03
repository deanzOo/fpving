import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";
import { CONTROL, Field, useDescription } from "./field.tsx";
import type { Described } from "./field.tsx";

interface TextFieldProps extends Described, Omit<ComponentProps<"input">, "id"> {
  readonly label: ReactNode;
  readonly numeric?: boolean;
}

/**
 * A labelled single-line input with a hint, or an error that replaces the hint and marks the input invalid.
 * `numeric` types in the readout face. Without a hint or an error, an `aria-describedby` and `aria-invalid` given
 * here stand, for a message shown elsewhere such as a refusal notice.
 *
 * @param props - The label, hint, error and the native input props.
 * @returns The field.
 */
export const TextField = ({ label, hint, error, numeric = false, className = "", ...rest }: TextFieldProps) => {
  const id = useId();
  const { control, description } = useDescription({ hint, error });
  return (
    <Field label={label} id={id} description={description}>
      <input
        {...rest}
        aria-describedby={control["aria-describedby"] ?? rest["aria-describedby"]}
        aria-invalid={control["aria-invalid"] ?? rest["aria-invalid"]}
        id={id}
        className={`${CONTROL} placeholder:text-ink-muted ${numeric ? "type-readout" : "type-body"} ${className}`}
      />
    </Field>
  );
};
