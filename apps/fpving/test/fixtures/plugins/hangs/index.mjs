export const manifest = {
  id: "hanging-shop",
  displayName: "Hanging Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["hanging.example"],
  capabilities: ["fetchListing"],
};

export const createStore = () => ({
  fetchListing: async () => {
    for (;;) {}
  },
});
