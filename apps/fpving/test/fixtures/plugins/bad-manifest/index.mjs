export const manifest = { id: "Not An Id", displayName: "", domains: [] };

export const createStore = () => ({ fetchListing: async () => ({ ok: false, error: { kind: "network", detail: "" } }) });
