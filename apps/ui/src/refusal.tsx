import { ApiErrorKind } from "@fpving/app/errors";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AlreadyTrackedFailure } from "./client.ts";
import type { ApiFailure } from "./client.ts";
import { LINK } from "./ui/link.ts";

const RESTARTING = "fpving is restarting its plugins for a settings change. Try again in a moment.";

/**
 * What a refused change says to the user: a sentence per error kind a screen can meet, linking to the product that
 * already watches a page for `already_tracked`, and the server's message for any other kind.
 *
 * @param failure - The failure.
 * @returns The explanation.
 */
export const explain = (failure: ApiFailure): ReactNode => {
  if (failure instanceof AlreadyTrackedFailure) {
    const { id, name } = failure.product;
    return (
      <>
        Already watched as <Link to="/products/$id" params={{ id }} className={LINK}>{name}</Link>
      </>
    );
  }
  switch (failure.kind) {
    case ApiErrorKind.NoPluginForDomain:
      return `No installed plugin handles this store (${failure.message}). List one in plugins.json, then check `
        + "Plugins.";
    case ApiErrorKind.PluginUnavailable:
      return "The plugin for this store is installed but not loaded. Check Plugins.";
    case ApiErrorKind.Restarting:
      return RESTARTING;
    case ApiErrorKind.ProductNotFound:
      return "This product is not watched any more.";
    case ApiErrorKind.ScanRunning:
      return "A scan is already running.";
    case ApiErrorKind.ShuttingDown:
      return "fpving is shutting down.";
    case ApiErrorKind.NotPending:
      return "This candidate was already reviewed.";
    case ApiErrorKind.AlreadySuggested:
      return "Another search saved candidates for this product meanwhile. Search again.";
    case ApiErrorKind.NoSourceListing:
      return "This product has no listing added by URL to search from. Add one first.";
    case ApiErrorKind.AlertNotFound:
      return "This alert no longer exists.";
    case ApiErrorKind.SettingsNotApplied:
      return "The settings were not applied and the old ones still hold. See the log, then try again.";
    default:
      return failure.message;
  }
};
