import type { ComponentProps, ReactNode } from "react";
import { useDescription } from "./field.tsx";
import type { Described } from "./field.tsx";

interface CheckboxProps extends Described, Omit<ComponentProps<"input">, "type" | "className"> {
  readonly label: ReactNode;
}

/**
 * A toggle with its label to the right; the whole label is the hit target and focus frames box and label together.
 *
 * @param props - The label, hint, error and the native checkbox props.
 * @returns The checkbox.
 */
export const Checkbox = ({ label, hint, error, ...rest }: CheckboxProps) => {
  const { control, description } = useDescription({ hint, error, ...rest });
  return (
    <div className="flex flex-col gap-1">
      <label className="focus-frame inline-flex cursor-pointer items-center gap-2 self-start type-body">
        <input
          {...rest}
          {...control}
          type="checkbox"
          className={"check-box m-0 grid size-4 cursor-pointer appearance-none place-content-center rounded-1 border "
            + "border-line-strong bg-page checked:border-signal checked:bg-signal"}
        />
        {label}
      </label>
      {description}
    </div>
  );
};
