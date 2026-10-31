/**
 * A screen that is not built yet: its heading and a note.
 *
 * @param props - The screen's title.
 * @returns The placeholder screen.
 */
export const Placeholder = ({ title }: { readonly title: string }) => (
  <section>
    <h1 className="text-2xl font-semibold">{title}</h1>
    <p className="mt-2 text-ink-muted">This screen is not built yet.</p>
  </section>
);

/**
 * What a path no route serves shows.
 *
 * @returns The not found screen.
 */
export const NotFound = () => (
  <section>
    <h1 className="text-2xl font-semibold">Page not found</h1>
    <p className="mt-2 text-ink-muted">No screen lives at this address.</p>
  </section>
);
