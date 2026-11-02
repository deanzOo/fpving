import type { ReactNode } from "react";

/** What a badge says about its thing; tones differ by fill weight as well as hue. */
export const BadgeTone = {
  Neutral: "neutral",
  Pending: "pending",
  Live: "live",
  Good: "good",
  Info: "info",
  Warning: "warning",
  Critical: "critical",
} as const;
type BadgeTone = (typeof BadgeTone)[keyof typeof BadgeTone];

const TONE: Readonly<Record<BadgeTone, string>> = {
  [BadgeTone.Neutral]: "border-line-strong text-ink-muted",
  [BadgeTone.Pending]: "border-dashed border-line-strong text-ink-muted",
  [BadgeTone.Live]: "border-transparent bg-signal-soft text-signal "
    + "before:size-1.5 before:bg-signal before:content-['']",
  [BadgeTone.Good]: "border-transparent bg-good-soft text-good",
  [BadgeTone.Info]: "border-transparent bg-info-soft text-info",
  [BadgeTone.Warning]: "border-warning bg-warning-soft text-warning",
  [BadgeTone.Critical]: "border-critical bg-critical text-on-critical",
};

/**
 * A short uppercase status beside the thing it describes: a word, a leading glyph (a square dot for live) and the
 * tone's colours, so colour is never the only signal.
 *
 * @param props - The tone, the glyph and the one to three words.
 * @returns The badge.
 */
export const Badge = ({ tone = BadgeTone.Neutral, glyph, children }: {
  readonly tone?: BadgeTone;
  readonly glyph?: string;
  readonly children: ReactNode;
}) => (
  <span className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-1 border px-1.5 type-label ${
    TONE[tone]}`}
  >
    {glyph === undefined ? null : <span aria-hidden="true">{glyph}</span>}
    <span>{children}</span>
  </span>
);

/**
 * The unread number, hidden at zero and from assistive tech: the parent's name carries the number.
 *
 * @param props - The count.
 * @returns The count, or nothing at zero.
 */
export const Count = ({ count }: { readonly count: number }) => count === 0
  ? null
  : (
      <span
        aria-hidden="true"
        className="inline-grid h-4.5 min-w-5 place-content-center rounded-1 bg-signal px-1 text-on-signal type-label"
      >
        {count}
      </span>
    );
