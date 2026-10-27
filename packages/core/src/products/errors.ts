/**
 * Why adding a product or a listing stored nothing. `invalid_url`: the input is not an absolute http(s) URL.
 * `no_plugin_for_domain`: no loaded plugin declares the URL's host. `already_tracked`: a listing already tracks the
 * normalized URL. `fetch_failed`: the store plugin could not fetch the listing. `product_not_found`: the product the
 * operation is about does not exist.
 */
export const AddErrorKind = {
  InvalidUrl: "invalid_url",
  NoPluginForDomain: "no_plugin_for_domain",
  AlreadyTracked: "already_tracked",
  FetchFailed: "fetch_failed",
  ProductNotFound: "product_not_found",
} as const;

/** One of the {@link AddErrorKind} values. */
export type AddErrorKind = (typeof AddErrorKind)[keyof typeof AddErrorKind];
