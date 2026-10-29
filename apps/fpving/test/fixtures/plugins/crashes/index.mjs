export const manifest = {
  id: "crashing-shop",
  displayName: "Crashing Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["crashing.example"],
  capabilities: ["fetchListing"],
};

export const createStore = () => ({
  fetchListing: () => {
    setTimeout(() => {
      throw new Error("the worker blew up");
    });
    return new Promise(() => {});
  },
});
