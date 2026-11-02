import type { ReactNode } from "react";

/** The tag words an empty state uses: nothing watched or listed, nothing waiting, or a chart without prices. */
export const EmptyTag = { NoSignal: "No signal", Clear: "Clear", NoData: "No data" } as const;
type EmptyTag = (typeof EmptyTag)[keyof typeof EmptyTag];

/**
 * What a list, table or chart shows when it has nothing: a dashed frame, a crosshair, the tag and one sentence that
 * says what to do.
 *
 * @param props - The tag and the sentence.
 * @returns The empty state.
 */
export const EmptyState = ({ tag, children }: { readonly tag: EmptyTag; readonly children: ReactNode }) => (
  <div className="flex items-start gap-4 rounded-2 border border-dashed border-line-strong px-4 py-6">
    <span aria-hidden="true" className="crosshair relative size-6 flex-none" />
    <div className="flex flex-col gap-1">
      <span className="type-label text-ink-muted">{tag}</span>
      <p className="type-body">{children}</p>
    </div>
  </div>
);
