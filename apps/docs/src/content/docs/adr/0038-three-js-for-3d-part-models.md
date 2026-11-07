---
title: "0038. three.js for 3D part models"
description: The parts atlas draws its models with three.js, built from code rather than loaded from model files.
---

- Status: Accepted
- Date: 2026-11-07

## Context and problem statement

The atlas explains FPV parts by letting a viewer turn a part, take it apart and click its pieces. That needs real-time 3D in the browser, and models whose pieces can be picked one at a time. Downloaded and manufacturer models often have unclear licences and rarely separate into the pieces the atlas explains.

## Considered options

- three.js, with models generated in code.
- three.js, with models loaded from files.
- `model-viewer`, a ready-made component with hotspots.
- Flat SVG drawings.

## Decision outcome

Use three.js and generate each model from its dimensions in code. The owner chose 3D after trying a working motor, and chose this look. `model-viewer` shows a whole file with hotspots, but does not offer pieces that move apart and ghost. SVG cannot be turned.

three.js is used directly, as the UI does with React and Recharts, rather than behind a port. It loads in its own chunk, only when the Atlas screen opens. Model colours are design tokens, and the 3D view draws only when something changed.

## Consequences

- Good: no model files, no licence questions, a small download, and pieces that separate cleanly and follow the theme.
- Good: every piece stays reachable through a list, so the 3D view is an aid and not the only way in.
- Bad: three.js adds about 630 kB (161 kB gzipped) to the first visit to the Atlas screen.
- Bad: a model is a clean technical drawing, not photo-real, and detailed circuit boards take the most work.
- Bad: tests render with a software GPU, so 3D tests are slow and their pointer actions need longer timeouts.
