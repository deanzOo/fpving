import type { ReactNode } from "react";

/** A notice's weight: critical for refusals and failures, warning for transient states, status for outcomes. */
export const NoticeTone = { Critical: "critical", Warning: "warning", Status: "status" } as const;
type NoticeTone = (typeof NoticeTone)[keyof typeof NoticeTone];

const LOOK: Readonly<Record<NoticeTone, { readonly box: string; readonly tag: string }>> = {
  [NoticeTone.Critical]: { box: "border-critical bg-critical-soft", tag: "text-critical" },
  [NoticeTone.Warning]: { box: "border-warning bg-warning-soft", tag: "text-warning" },
  [NoticeTone.Status]: { box: "border-line bg-surface", tag: "text-ink-muted" },
};

/**
 * One sentence about what just happened, announced: an alert for a critical notice, a status otherwise. The live
 * region stays mounted while there is nothing to say, so the next message is announced; a new tone mounts a new one.
 *
 * @param props - The tone, the one-word tag, the message and its id, for a control the message describes.
 * @returns The notice.
 */
export const Notice = ({ tone, tag, id, children }: {
  readonly tone: NoticeTone;
  readonly id?: string | undefined;
  readonly tag: string;
  readonly children: ReactNode;
}) => (
  <div key={tone} role={tone === NoticeTone.Critical ? "alert" : "status"}>
    {!children
      ? null
      : (
          <p className={`flex items-baseline gap-3 rounded-2 border px-3 py-2 text-ink ${LOOK[tone].box}`}>
            <span className={`flex-none type-label ${LOOK[tone].tag}`}>{tag}</span>
            {" "}
            <span id={id} className="type-body">{children}</span>
          </p>
        )}
  </div>
);
