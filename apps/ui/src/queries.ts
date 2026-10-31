/** The query keys the screens share, so a change can invalidate what it affects. */
export const QueryKey = {
  Watchlist: ["watchlist"],
  UnreadAlerts: ["alerts", "unread"],
  Alerts: ["alerts"],
  Scan: ["scan"],
  Product: ["product"],
  Candidates: ["candidates"],
  Settings: ["settings"],
  Plugins: ["plugins"],
} as const;
