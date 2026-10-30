import sdkPackage from "../package.json" with { type: "json" };

/**
 * The version of this `@fpving/plugin-sdk`, read from its `package.json`. The host checks each manifest's
 * `sdkVersion` range against it.
 */
export const SDK_VERSION: string = sdkPackage.version;
