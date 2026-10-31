/** The query keys the screens share, so a change can invalidate what it affects. */
export const QueryKey = {
  Watchlist: ["watchlist"],
  UnreadAlerts: ["alerts", "unread"],
} as const;
