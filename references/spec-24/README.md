# Approved spec and UI references

Spec: [Build approved Multi-Rate Pricing Calculator MVP Copy](https://github.com/SpamArtist/web-llm-template/issues/18).

These are the approved Variant B (Ledger) design references for the fresh implementation. Prototype source and snapshots are preserved byte-for-byte. The original prototype includes other variants; only Variant B is approved. In-memory prototype logic is not production implementation.

From the root of a checkout of this reference branch, run:

```sh
node prototype/dashboard-editor/server.mjs
```

Open `http://127.0.0.1:4173/?variant=B`. The preserved original prototype README mentions an npm script from its source repository; the direct command above works here without changing package.json.

- [Prototype HTML, CSS, JavaScript and server](../../prototype/dashboard-editor/)
- [Dashboard snapshot](ledger-dashboard-desktop.png)
- [Editor desktop](ledger-editor-desktop.png) and [narrow](ledger-editor-narrow.png)
- [Summary desktop](ledger-summary-desktop.png) and [narrow](ledger-summary-narrow.png)
- [Playwright capture metadata](capture-evidence.json)
- [Source glossary](CONTEXT.md)

The PNGs are intentional product-design reference fixtures used by the issue descriptions. The three `*-rendered.html` files are preserved DOM source captures for inspection, not standalone runnable pages. Capture metadata records the original source commit and original capture run; migration does not represent a new UI test run.

Provenance: prototype source commit `114b35700efd35e67267930e2a36f0b5fdb961a9`; original snapshot commit `34a87aabc3b500ce64735952347d07ec50d00845` in `SpamArtist/multi-rate-pricing-calculator`. Historical decision issues remain in the source repository.
