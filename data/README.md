# `data/` — generated artifacts that ship with the binary

Generated data files that the MCP server reads at runtime and that
ship with the v0.1.x binary. Everything here is committed.

## Files

| File | Source | Regen | Regenerate when |
|---|---|---|---|
| `factory-data.json` | AM4 hardware (104 factory presets) | `npm run extract-factory-data` | Fractal ships an AM4 firmware update that changes factory presets — uncommon |

**Pre-flight for `factory-data.json`:** the AM4 must be at factory state
when the script runs. Run `am4_restore_factory_range A01..Z04` first if
any locations are customised (destructive — back up via AM4-Edit first).

## Other generated files in the repo

Some generated artifacts live next to their consumers rather than in
`data/`. The list is short:

| File | Regen | Notes |
|---|---|---|
| `src/fractal/shared/lineage/*-lineage.json` | `npm run extract-lineage` | Fractal lineage data shared across AM4 + Axe-Fx II |
| `src/fractal/shared/lineage/axefx2-*-lineage.json` | `npm run extract-axe-fx-ii-lineage` | Re-keyed against Axe-Fx II enum tables |
| `src/fractal/axe-fx-ii/{params.ts, blockTypes.ts}` | `npm run extract-axe-fx-ii-params` | Regenerated from wiki + Axe-Edit XML |

`npm run regen` runs every hardware-free generator in sequence.

## Regeneration policy

If you change an extractor whose output is committed, re-run the
extractor and commit the regenerated output in the same PR. The
`preflight` chain does **not** auto-regen — that would mask drift
between extractor logic and committed output. Treat regeneration as
an explicit step.
