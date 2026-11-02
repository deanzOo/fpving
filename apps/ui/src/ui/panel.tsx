import { useId } from "react";
import type { ReactNode } from "react";

/**
 * A `surface` block on a hairline for a chart, a form or a summary, with an optional head: the title in the label
 * style and a slot on the right. `featured` frames the one panel per screen that is the reason to look.
 *
 * @param props - The title, the head's right slot, whether it is featured, and the content.
 * @returns The panel, a named region when it has a title.
 */
export const Panel = ({ title, aside, featured = false, children }: {
  readonly title?: string;
  readonly aside?: ReactNode;
  readonly featured?: boolean;
  readonly children: ReactNode;
}) => {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title === undefined ? undefined : titleId}
      className={`rounded-2 border bg-surface p-4 ${featured ? "reticle border-line-strong" : "border-line"}`}
    >
      {title === undefined
        ? null
        : (
            <div className="-mx-4 -mt-4 mb-4 flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <h2 id={titleId} className="type-label text-ink-muted">{title}</h2>
              {aside}
            </div>
          )}
      {children}
    </section>
  );
};
