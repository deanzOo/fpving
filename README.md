# fpving

An open-source companion for people entering the FPV drone hobby. The first piece is a gear watcher: track the same product across stores, see the true landed cost in your own currency, and get notified about meaningful deals without checking sites by hand.

## Status

Pre-alpha, under construction. Nothing is released yet and interfaces will change.

## How it works

fpving is a local web app: a Node server with SQLite on your machine and a React UI in your browser. Nothing is hosted and each machine keeps its own data.

- Watch products; each product has one listing per store.
- Paste a URL and LLM-assisted matching suggests the same product in other stores for you to confirm.
- Alerts for price drops, back in stock and new cheapest listing.
- Prices shown in your display currency, with landed cost for your ship-to country.

## Plugins

Store support comes exclusively from plugins. A plugin is an npm package or local folder that exports a manifest and a store factory, built against `@fpving/plugin-sdk`. This repository ships no store plugins.

Plugins are for personal use. Respect each site's terms of service. Plugins run in worker threads for crash containment, not as a security sandbox, so install only plugins you trust.

## Documentation

Guides, architecture, decision records and the API reference: <https://deanzoo.github.io/fpving/>.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE)
