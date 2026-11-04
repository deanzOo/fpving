import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";
import { CONTROL, Field, useDescription } from "./field.tsx";
import type { Described } from "./field.tsx";

interface SelectProps extends Described, Omit<ComponentProps<"select">, "id"> {
  readonly label: ReactNode;
}

/**
 * A native select restyled like TextField, with the same label, hint and error wiring, for a closed set of values.
 *
 * @param props - The label, hint, error, the options as children and the native select props.
 * @returns The field.
 */
export const Select = ({ label, hint, error, className = "", ...rest }: SelectProps) => {
  const id = useId();
  const { control, description } = useDescription({ hint, error, ...rest });
  return (
    <Field label={label} id={id} frame="select-chevron" description={description}>
      <select
        {...rest}
        {...control}
        id={id}
        className={`${CONTROL} cursor-pointer appearance-none pr-8 type-body ${className}`}
      />
    </Field>
  );
};
