import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";
import { AREA, CONTROL, Field, useDescription } from "./field.tsx";
import type { Described } from "./field.tsx";

interface Shared extends Described {
  readonly label: ReactNode;
  readonly numeric?: boolean;
}

type TextFieldProps = Shared & (
  | (Omit<ComponentProps<"input">, "id"> & { readonly multiline?: false })
  | (Omit<ComponentProps<"textarea">, "id"> & { readonly multiline: true })
);

/**
 * A labelled text input with a hint, or an error that replaces the hint and marks the input invalid. `numeric` types
 * in the readout face; `multiline` makes it a text box of several lines, for pasted text.
 *
 * @param props - The label, hint, error, whether it is numeric or multiline, and the native input or textarea props.
 * @returns The field.
 */
export const TextField = ({ label, hint, error, numeric = false, className = "", ...rest }: TextFieldProps) => {
  const id = useId();
  const { control, description } = useDescription({ hint, error, ...rest });
  const face = `placeholder:text-ink-muted ${numeric ? "type-readout" : "type-body"} ${className}`;
  if (rest.multiline === true) {
    const { multiline, ...area } = rest;
    return (
      <Field label={label} id={id} description={description}>
        <textarea {...area} {...control} id={id} aria-multiline={multiline} className={`${AREA} ${face}`} />
      </Field>
    );
  }
  const { multiline, ...input } = rest;
  return (
    <Field label={label} id={id} description={description}>
      <input {...input} {...control} id={id} aria-multiline={multiline} className={`${CONTROL} ${face}`} />
    </Field>
  );
};
