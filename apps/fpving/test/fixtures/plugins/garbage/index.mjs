export const manifest = {
  id: "garbage-shop",
  displayName: "Garbage Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["garbage.example"],
  capabilities: ["fetchListing", "search"],
};

export const createStore = () => ({
  fetchListing: async () => ({ ok: true, value: { title: "", itemPrice: 0 } }),
  search: async () => "not a result",
});
