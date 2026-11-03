import type { ComponentProps, ReactNode } from "react";

/** How much weight a button carries: one primary per form or header, danger only inside Confirm. */
export const ButtonVariant = { Primary: "primary", Secondary: "secondary", Ghost: "ghost", Danger: "danger" } as const;
type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant];

/** Regular, or small for table rows and list items. */
export const ButtonSize = { Regular: "regular", Small: "small" } as const;
type ButtonSize = (typeof ButtonSize)[keyof typeof ButtonSize];

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  [ButtonVariant.Primary]: "border-signal bg-signal text-on-signal",
  [ButtonVariant.Secondary]: "border-line-strong text-ink hover:bg-surface-raised",
  [ButtonVariant.Ghost]: "border-transparent text-ink-muted hover:text-ink",
  [ButtonVariant.Danger]: "border-critical bg-critical text-on-critical",
};

const SIZE: Readonly<Record<ButtonSize, string>> = {
  [ButtonSize.Regular]: "h-(--control-height) px-3",
  [ButtonSize.Small]: "h-7 px-2",
};

const BASE = "pending-mark inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-1 border "
  + "type-control aria-disabled:cursor-progress aria-disabled:border-line aria-disabled:bg-surface "
  + "aria-disabled:text-ink-muted";

interface ButtonProps extends ComponentProps<"button"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly pending?: boolean;
  readonly pendingLabel?: ReactNode;
}

/**
 * One action, labelled with its verb. While `pending` it stays focusable, is marked `aria-disabled`, shows
 * `pendingLabel` when given and ignores clicks, so it never submits its form twice.
 *
 * @param props - The variant, size, pending state and the native button props.
 * @returns The button.
 */
export const Button = ({
  variant = ButtonVariant.Secondary,
  size = ButtonSize.Regular,
  pending = false,
  pendingLabel,
  type = "button",
  className = "",
  onClick,
  children,
  ...rest
}: ButtonProps) => (
  <button
    {...rest}
    type={type}
    aria-disabled={pending}
    className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    onClick={pending
      ? (event) => {
          event.preventDefault();
        }
      : onClick}
  >
    {pending ? pendingLabel ?? children : children}
  </button>
);
