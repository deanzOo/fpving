/**
 * Why adding a product or a listing stored nothing. `invalid_url`: the input is not an absolute http(s) URL.
 * `no_plugin_for_domain`: no loaded plugin declares the URL's host. `already_tracked`: a listing already tracks the
 * normalized URL. `fetch_failed`: the store plugin could not fetch the listing.
 */
export const AddErrorKind = {
  InvalidUrl: "invalid_url",
  NoPluginForDomain: "no_plugin_for_domain",
  AlreadyTracked: "already_tracked",
  FetchFailed: "fetch_failed",
} as const;

/** One of the {@link AddErrorKind} values. */
export type AddErrorKind = (typeof AddErrorKind)[keyof typeof AddErrorKind];
