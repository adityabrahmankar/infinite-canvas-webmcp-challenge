# Infinite Canvas — WebMCP Challenge Edition

This is the intentionally small, self-contained WebMCP proof of concept. It is not a copy of the private Infinite Canvas product. The challenge build contains a seeded canvas, a structured layer tree, basic text/style editing, shared human+agent document tools, and a real design-to-artifact handoff.

## The demonstration

A person and an agent share one live canvas document. The agent can inspect structure, edit text and styles, create/move/resize/delete layers, work from local reference images, undo/redo, import project JSON, and export deterministic artifacts — while the person keeps the final say in the same UI.

The public page registers 22 focused tools through `document.modelContext.registerTool`:

- `inspect_canvas`
- `get_design_tree`
- `find_nodes`
- `set_design_text`
- `apply_design_styles`
- `set_layout`
- `add_reference_image`
- `list_reference_images`
- `inspect_reference_image`
- `recreate_from_reference`
- `create_node`
- `create_tree`
- `delete_nodes`
- `move_nodes`
- `resize_node`
- `select_nodes`
- `capture_preview`
- `undo_document`
- `redo_document`
- `import_project`
- `export_design`
- `reset_document`

The app uses a tiny in-memory document model. Document mutations are explicit and deterministic. Operation IDs make retries safe for reference add, recreate, import, and export. `export_design` rejects stale `baseRevision` values so an outdated agent call cannot overwrite newer human work.

`export_design` creates a deterministic PNG, SVG, self-contained HTML, or versioned project JSON artifact. The Export panel lives in the right inspector rail so the canvas stays clear; it shows the revision, dimensions, byte size, checksum, and a real Download action. Project JSON can be opened again with the project button, so the result survives a reset or a new browser session. Ordinary edits also support undo/redo from the bottom-centered canvas toolbar, keyboard shortcuts, and WebMCP tools.

Canvas navigation works with any pointing device: drag an empty part of the canvas (or use a middle/right-button drag) to pan, use a mouse or trackpad wheel to move, and hold ⌘/Ctrl while scrolling or pinching to zoom around the pointer. Focus the canvas for arrow/WASD panning, `+`/`-` (including the numeric keypad) zooming, or `0`/Home to reset the view.

Drop an image onto the canvas, click the reference-image button, or paste an image from the clipboard. The image stays local and in memory. `inspect_reference_image` returns the image to an agent as image content, and `recreate_from_reference` adds a small editable frame informed by that reference. Images are limited to 1.5 MB from the UI (2 MB at the tool boundary); the recreation is an editable scaffold, not a claim of pixel-perfect inference.

The left AST layer tree is interactive: use the chevron on any row with children to collapse or expand that subtree, or use the Layers heading button to collapse/expand every subtree at once. Collapsing only hides tree rows; it never changes the canvas document or the selected layer. Reset restores the seed and expands every subtree. The small theme button in the header switches between the dark “Graphite” chrome and a light “Paper” chrome; the authored design colors remain intact in both themes.

The Agents tab is an in-page browser agent. Cloudflare hosts the Worker and keeps session/quota state. Inference goes through **Vercel AI Gateway**. The current picker exposes two configured modes: discounted `meta/muse-spark-1.3-contributor` (vision-capable, default) and `google/gemini-3.8-flash` (vision-capable). Attach reference images with the composer `+` button, paste, or drop — they appear as chips, land on the canvas, and are sent to the selected vision model. Each send includes the live canvas selection (ids, names, text, bounds) so the model already knows what is selected. Local `wrangler dev` is unlimited so you can test output; the deployed Worker still allows **5 requests per visitor**. Destructive tools can require approval unless Auto approve is on.

Set `AI_GATEWAY_API_KEY` in `.dev.vars` for local, and `wrangler secret put AI_GATEWAY_API_KEY` before deploy. Create a key with `npx vercel ai-gateway api-keys create`.

## Local run

Requires [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev -- --port 3458
pnpm dev:worker
```

`pnpm dev` serves the canvas. `pnpm dev:worker` is required for the Agents tab (it proxies `/api` to the Worker on port 8787). Open `http://localhost:3458` in ChatGPT's in-app Browser at 1280×720. Confirm the footer shows `WebMCP ready · 22`, the toolbar is a bottom-centered horizontal strip, and export opens in the right inspector rail.

```sh
pnpm test
pnpm build
```

## Judge prompt

> Inspect the canvas with inspect_canvas and get_design_tree. Select the hero title, change its text to something clearer, apply a stronger color and font size with apply_design_styles, then create a new button under the main artboard. Move and resize that button, export the artboard as SVG and PNG, then export project JSON. Tell me the artifact filenames, revisions, dimensions, and checksums. After that, undo one edit and redo it, then reset_document and confirm the seed is restored.

For the reference-image path, paste or drop an image, ask the agent to call `list_reference_images` and `inspect_reference_image`, then ask it to call `recreate_from_reference` for the selected reference. The result is a visible, editable scaffold beside the reference; it is intentionally not presented as pixel-perfect image-to-design inference.

## Deliberate boundary

Kept: the seeded visual canvas, top-level artboards, collapsible AST tree and selection, collapse-all control, dark/light editor chrome, basic text/style edits, create/move/resize/delete layers, mouse/trackpad/keyboard navigation, local reference image add/paste/drop, image inspection, editable reference recreation, undo/redo, reset, deterministic PNG/SVG/HTML/project-JSON export, project JSON reopen, tests, and native WebMCP registration.

Removed from this challenge edition: multi-lane experiment orchestration, arbitrary external-page capture, CDP capture sessions, the local MCP bridge/server, Figma/import integrations, vector pen editing, WebGL/shader effects, multi-page management, PDF/JSX export, advanced components/symbols, authentication, accounts, collaboration, cloud storage, product roadmaps, internal notes, and test artifacts. The public exporter is deliberately limited to the reduced `DesignNode` model; the private product's compiler and PDF/JSX systems remain private.

There are no fake waits and no claim of exact editable pixel parity. This is a focused shared-document demo, not the private product source.

## Deployment

```sh
pnpm deploy
```

The Cloudflare Worker name is `webmcp-challenge`. Do not use the private/current project or its Worker for judging.

Live demo: <https://webmcp-challenge.adityabrahmankar9.workers.dev/>

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). You may use, modify, and redistribute the project, but retain the copyright and attribution notice and link back to the source repository.
