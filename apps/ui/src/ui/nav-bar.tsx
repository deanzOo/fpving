import { Link } from "@tanstack/react-router";
import { Count } from "./badge.tsx";
import { ThemeSwitch } from "./theme-switch.tsx";

const NAV = [
  { to: "/", label: "Watchlist" },
  { to: "/gear", label: "My gear" },
  { to: "/matches", label: "Matches" },
  { to: "/alerts", label: "Alerts" },
  { to: "/settings", label: "Settings" },
  { to: "/plugins", label: "Plugins" },
  { to: "/atlas", label: "Atlas" },
] as const;

const ALERTS = "/alerts";

const SKIP = "sr-only rounded-1 bg-surface-raised px-3 py-2 type-control focus:not-sr-only focus:absolute focus:left-4 "
  + "focus:top-4";
const LINK = "inline-flex h-(--control-height) items-center gap-2 px-3 type-control hover:text-ink";

/**
 * The app's top bar: a skip link to `main`, the wordmark, the seven screens in their fixed order with the current one
 * in muted brackets and the unread count on Alerts, and the theme switch.
 *
 * @param props - The unread alert count and the id of the main element.
 * @returns The skip link and the bar.
 */
export const NavBar = ({ unread, mainId }: { readonly unread: number; readonly mainId: string }) => (
  <>
    <a href={`#${mainId}`} className={SKIP}>Skip to content</a>
    <header className="border-b border-line bg-page">
      <div className="mx-auto flex max-w-(--content-max) flex-wrap items-center gap-1 px-4 py-3">
        <span className="mr-4 font-semibold type-readout">fpving</span>
        <nav aria-label="Main" className="flex flex-wrap gap-1">
          {NAV.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={LINK}
              activeProps={{ className: "reticle reticle-muted text-ink" }}
              inactiveProps={{ className: "text-ink-muted" }}
              activeOptions={{ exact: true }}
              aria-label={to === ALERTS && unread > 0 ? `${label}, ${String(unread)} unread` : undefined}
            >
              {label}
              {to === ALERTS ? <Count count={unread} /> : null}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <ThemeSwitch />
        </div>
      </div>
    </header>
  </>
);
