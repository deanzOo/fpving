# fpving

An open-source companion for people entering the FPV drone hobby. The first piece is a gear watcher: track the same product across stores, see the true landed cost in your own currency, and get notified about meaningful deals without checking sites by hand.

## Status

Early and pre-1.0: interfaces can change between releases. You run it from a clone, and watching a store needs a plugin for that store, which you write or bring yourself.

## What it does

fpving is a local web app: a Node server with SQLite on your machine and a React UI in your browser. Nothing is hosted and each machine keeps its own data.

- Watch products; each product has one listing per store.
- Paste a URL and LLM-assisted matching suggests the same product in other stores for you to confirm. The LLM needs your own Anthropic API key; without one, candidates are saved unjudged.
- Alerts for price drops, back in stock and new cheapest listing.
- Prices shown in your display currency, with landed cost for your ship-to country.

## Install and run

You need Node 24 (`nvm install` reads `.nvmrc`), which includes corepack.

```sh
git clone https://github.com/deanzOo/fpving.git
cd fpving
corepack enable
pnpm install
pnpm --filter @fpving/app exec playwright install chromium
pnpm worktree:init
pnpm build
pnpm --filter @fpving/app start
```

Then open the address it prints. Stop it with Ctrl+C.

Chromium is the browser that plugins fetch pages through; the app starts without it, and a plugin that only uses HTTP never needs it. `pnpm worktree:init` writes a `.env` with this checkout's own port and data directory; see [CONTRIBUTING.md](CONTRIBUTING.md#worktree-workflow).

## Plugins

Store support comes exclusively from plugins. This repository ships no store plugins. To write one, see [Writing a plugin](https://deanzoo.github.io/fpving/writing-a-plugin/).

Plugins are for personal use. Respect each site's terms of service. Plugins run in worker threads for crash containment, not as a security sandbox, so install only plugins you trust.

## Documentation

Guides, architecture, decision records and the API reference: <https://deanzoo.github.io/fpving/>.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE)
