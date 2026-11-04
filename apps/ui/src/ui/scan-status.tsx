import type { ReactNode } from "react";
import { Button } from "./button.tsx";

/**
 * The scan now control with its status line, the one place the interface moves: while a scan runs, a blinking
 * SCANNING dot and a sweep, both still under reduced motion, and the button held. The status line is a live region.
 *
 * @param props - Whether a scan runs, whether a start is on its way, the start handler and the status sentence.
 * @returns The control.
 */
export const ScanStatus = ({ running, starting, onStart, children }: {
  readonly running: boolean;
  readonly starting: boolean;
  readonly onStart: () => void;
  readonly children: ReactNode;
}) => (
  <div className="flex flex-wrap items-center gap-3">
    {running
      ? (
          <>
            <span className="rec inline-flex items-center gap-2 text-signal type-label">Scanning</span>
            <span aria-hidden="true" className="sweep h-0.5 w-40" />
          </>
        )
      : null}
    <p role="status" className="text-ink-muted type-small">{children}</p>
    <Button pending={running || starting} onClick={onStart}>Scan now</Button>
  </div>
);
