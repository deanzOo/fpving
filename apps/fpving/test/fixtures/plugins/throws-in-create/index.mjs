export const manifest = {
  id: "throwing-shop",
  displayName: "Throwing Shop",
  version: "1.0.0",
  sdkVersion: ">=0.0.0 <1.0.0",
  domains: ["throwing.example"],
  capabilities: ["fetchListing"],
};

export const createStore = () => {
  throw new Error("createStore exploded");
};
