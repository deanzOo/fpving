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
 * `numeric` types in the readout face.
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
        {...control}
        id={id}
        className={`${CONTROL} placeholder:text-ink-muted ${numeric ? "type-readout" : "type-body"} ${className}`}
      />
    </Field>
  );
};
