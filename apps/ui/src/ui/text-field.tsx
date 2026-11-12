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

const native = <T extends { readonly multiline?: boolean }>(props: T): Omit<T, "multiline"> => {
  const copy: Omit<T, "multiline"> & { multiline?: boolean } = { ...props };
  delete copy.multiline;
  return copy;
};

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
    return (
      <Field label={label} id={id} description={description}>
        <textarea {...native(rest)} {...control} id={id} className={`${AREA} ${face}`} />
      </Field>
    );
  }
  return (
    <Field label={label} id={id} description={description}>
      <input {...native(rest)} {...control} id={id} className={`${CONTROL} ${face}`} />
    </Field>
  );
};
