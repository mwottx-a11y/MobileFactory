# Resonance Works

A mobile-first 3D factory-automation game built with three.js. Mine raw resources, smelt and refine them, chain intermediate products into research data, and climb a 60-node technology tree toward the final project: the **Resonance Gate**.

No build step, no dependencies to install — three.js is vendored in `vendor/`.

## Running

Serve the folder over HTTP (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000 on your phone or desktop
```

The game autosaves to `localStorage` every minute and when the tab is hidden. Saves can be exported/imported as text from the menu.

## What's in it

**Resources** — iron, copper, coal, stone, quartz, bauxite (solids), crude oil seeps and water (fluids). Ore patches deplete; richer patches lie further from spawn.

**Production chains** — 90+ recipes across five machine categories (hand/assembler, fluid assembler, furnace, chemical plant, refinery). Oil refining produces **tar as a solid by-product** that will back up your refinery unless you burn it, turn it into solid fuel or lubricant, or crack it back into gas.

**Five data types** — Kinetic → Logistic → Chemical → Structural → Quantum, each requiring a substantially deeper production chain than the last.

**Logistics** — single-lane belts in three tiers, belt tunnels, splitters with filters and priority, side-loading; six inserter types including filter and stack inserters; chests; **Uplink/Downlink chests** wired to your personal inventory so you can automate your own building supply.

**Fluids** — pipes merge into single-fluid networks; machines have directional input/output ports (blue/orange nubs). Keeping fluids separated, and crossing lines with pipe tunnels, is part of the puzzle.

**Power** — offshore pump → boiler → steam engines, solar panels with a day/night cycle, accumulators, three pole tiers with supply areas and wire reach. Brown-outs slow everything proportionally.

**Modules & beacons** — speed, productivity and efficiency modules (3 tiers each); beacons broadcast half their effect to neighbours (no productivity).

**Automation aids** — copy/paste blueprints with a saved library, ghost placement that builds itself when items arrive, recursive hand-crafting of intermediates, auto-queued research prerequisites, a production-statistics panel, and a **ratio planner** that computes machine counts and raw-resource needs for any target rate.

## Controls

| Action | Touch | Mouse / keyboard |
|---|---|---|
| Pan | drag (Inspect) or two fingers | right-drag, WASD |
| Zoom | pinch | wheel, `+`/`-` |
| Place | tap; drag for lines (belts/pipes turn corners) | click / drag |
| Rotate | ⟳ button | `R` |
| Configure building | tap it in Inspect | click |
| Copy / Paste / Remove | toolbar | `C` / `V` / `X` |
| Craft, Research, Stats | toolbar / top bar | `E`, `T`, `P` |
| Pause | — | Space |

## Code layout

| File | Purpose |
|---|---|
| `js/data.js` | Items, fluids, recipes, buildings, technologies |
| `js/world.js` | Seeded terrain, ore patch and oil seep generation |
| `js/sim.js` | Fixed-step (30 Hz) simulation: entities, belts, inserters, power and fluid networks, research, crafting, save/load |
| `js/render.js` | three.js scene: instanced building parts, scrolling belts, streamed belt items, overlays |
| `js/input.js` | Touch/mouse gestures, build tools, blueprints |
| `js/ui.js` | HUD, panels, research tree, stats, planner, objectives |
| `js/icons.js` | Procedurally drawn item/building icons |
| `js/main.js` | App glue, game loop, persistence |

The simulation has no DOM or three.js dependency and runs headless under Node for testing.
