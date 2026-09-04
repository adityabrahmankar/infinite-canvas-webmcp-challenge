# Infinite Canvas — WebMCP Challenge Edition

## One-line Summary

A shared human-and-agent infinite canvas where 22 WebMCP tools inspect, edit, and export one live document while the person keeps the final say.

## Problem

Visual editors are precise for people but opaque to agents. A browser agent that only sees pixels has to guess which layer is selected, infer hierarchy and dimensions, and click through brittle controls. That makes even small design changes difficult to supervise: an agent can change the wrong object, lose the user's latest edit, or produce an artifact without a reliable handoff.

## Solution

Infinite Canvas makes the document model available to both the person and the agent. The canvas has a seeded, editable design with a real layer tree, selection, inspector, auto-layout, local reference images, history, and export. The browser exposes a focused WebMCP registry on `document.modelContext`; an agent can inspect the structured tree, apply a targeted text/style/layout change, create or remove nodes, and export a deterministic artifact. The human still sees and edits the same document, can approve destructive actions, and can undo or redo the latest change.

The reference-image workflow keeps the distinction clear: a local or pasted image can be placed on the canvas, returned to a vision-capable agent as image content, and used to create an editable scaffold. The scaffold is a starting point for editing, not a claim of pixel-perfect image-to-design inference.

## Why This Matters

This is a strong WebMCP use case because a design document is structured, stateful, and hard to operate reliably through screenshots alone. WebMCP lets the site describe its real operations and input schemas to an agent. The result is a better shared workflow: agents can make bounded, inspectable changes, people can keep working visually, and both sides use the same revisioned document rather than separate approximations.

The demo focuses on a small but concrete capability: moving from a natural-language request to a visible, editable design change and then to a reusable artifact. It does not claim to replace a full design suite.

## How We Used AI

The in-page Agents tab sends a user's prompt, the current selection summary, and optional local reference images to a Cloudflare Worker. The Worker keeps the agent turn and chat history in a `CanvasAgent` Durable Object and calls the Vercel AI Gateway with the registered tool definitions. The agent can choose between the two configured vision-capable modes in the picker. Tool calls come back to the page, where the corresponding WebMCP handlers execute against the live canvas. Tool results are fed back for a concise response and visible tool timeline.

The AI is used for interpretation and orchestration; the document mutations, validation, layout calculations, history, and exporters are deterministic TypeScript code. The deployed Worker applies a five-request-per-visitor limit; local `wrangler dev` requests are treated as unlimited for development.

## How We Used Codex

Codex was used to build and iterate on the challenge edition: shape the reduced public scope, implement the shared document model and WebMCP registry, wire the Cloudflare Worker agent loop, add local persistence and reference-image handling, write tests, debug layout/export edge cases, and verify the live browser surface. Codex also helped turn the current implementation into this evidence-based submission draft. The project description intentionally separates working features from future ideas and known limits.

## Key Features

- **Structured WebMCP registry:** 22 tools are registered through `document.modelContext.registerTool`, with read-only and destructive annotations and a small in-page polyfill when native browser support is absent.
- **Shared editable document:** a seeded canvas, nested layer tree, selection, inspector controls, and direct manipulation are backed by one `ChallengeStore`.
- **Agent-safe editing:** inspect the canvas/tree, find nodes, set text, apply CSS-like styles, configure flex row/column layout, create one node or an atomic nested tree, move/resize/delete layers, and select layers.
- **Reference workflow:** add a local or pasted image, list and inspect references, and create a small editable recreation scaffold informed by that image. Image data stays local to the browser document/session.
- **Reversible changes:** document edits support undo/redo, keyboard shortcuts, and visible tool results; reset returns to the deterministic seed.
- **Deterministic handoff:** export the selected/root design as PNG, SVG, self-contained HTML, or versioned project JSON. Export receipts show revision, dimensions, byte size, checksum, and a real download action; stale `baseRevision` exports are rejected.
- **Code preview:** selected layers compile to Tailwind-style classes, React JSX, and HTML in the inspector's Code tab.
- **Local continuity:** the document is stored in browser local storage; image payloads use IndexedDB, and the agent thread is persisted without copying large image data into chat history.
- **Live agent surface:** the Agents tab shows the prompt, tool timeline, reasoning, approvals, model choice, quota, and resulting canvas state in one page.

## Architecture

The frontend is a Vite + TypeScript app. `src/store.ts` owns the in-memory document, revisions, snapshots, history, and reference metadata. `src/tools.ts` maps the 22 public operations to validated store actions. `src/tool-catalog.ts` keeps names, schemas, descriptions, and safety annotations in one registry. `src/webmcp.ts` registers those definitions on native `document.modelContext` or a local polyfill. `src/renderer.ts`, `src/interaction.ts`, `src/panels.ts`, and `src/compiler.ts` provide the canvas, inspector, navigation, and code/export views. `src/persist.ts` separates serializable document state from image payloads and saved agent history. `src/exporter.ts` produces the deterministic artifacts.

The optional agent loop is in `src/agent.ts` and `src/agent-protocol.ts`. `worker/index.ts` exposes the agent endpoints, `worker/canvas-agent.ts` stores per-visitor turn state in a Cloudflare Durable Object, and `worker/gateway.ts` formats tool-aware messages for the Vercel AI Gateway. `wrangler.toml` serves the built Vite assets and routes `/api/*` to the Worker.

## Testing Instructions

Open the live URL in ChatGPT's in-app browser or Google Chrome with WebMCP enabled:

`https://webmcp-challenge.adityabrahmankar9.workers.dev/`

1. Open **Agents** and confirm the footer reads **WebMCP ready · 22**.
2. Use the prompt below or ask the agent to inspect the current canvas with `inspect_canvas` and `get_design_tree`.
3. Select the hero title, change its text, apply a named color and larger font size, then create a button with `create_node` or `create_tree`.
4. Move and resize the button, then export SVG and PNG. Check the export receipt's revision, dimensions, byte size, checksum, and download action.
5. Export project JSON, reset the document, use **Open project** to reopen the JSON, and confirm the edited document returns.
6. Undo one edit and redo it. For the reference path, add a local image, call `list_reference_images` and `inspect_reference_image`, then call `recreate_from_reference` and edit the resulting scaffold.

Judge prompt:

> Inspect the canvas with inspect_canvas and get_design_tree. Select the hero title, change its text to something clearer, apply a stronger color and font size with apply_design_styles, then create a new button under the main artboard. Move and resize that button, export the artboard as SVG and PNG, then export project JSON. Tell me the artifact filenames, revisions, dimensions, and checksums. After that, undo one edit and redo it, then reset_document and confirm the seed is restored.

For local development, run `pnpm install`, `pnpm dev -- --port 3458`, and `pnpm dev:worker` in separate terminals. Run `pnpm test` (66 tests currently pass) and `pnpm build` (production build currently passes). The deployed Worker needs `AI_GATEWAY_API_KEY` for the Agents tab; no login is required by the app itself.

## Public Demo Link

https://webmcp-challenge.adityabrahmankar9.workers.dev/

## Public Repository Link

https://github.com/adityabrahmankar/infinite-canvas-webmcp-challenge

The repository is public and contains the challenge source, tests, instructions, `LICENSE`, and `NOTICE` on the prepared local checkout. The public `origin/main` branch is one commit behind this checkout, so the prepared license and submission-document changes still need to be pushed before the final Devpost form is sent.

## Demo Video

TODO — record and add a public YouTube video under three minutes with audio. The video should show the live URL, the **WebMCP ready · 22** status, one structured inspection/edit flow, one export receipt, and a short explanation of why structured tools are better than screenshot guessing. Add the final YouTube URL here and to the Devpost form.

## Screenshot Shot List

Capture 3–5 screenshots from the deployed app (prefer a clean browser session with no private chat history):

1. **Hero overview:** the seeded canvas, layer tree, inspector, and bottom toolbar visible; show the WebMCP ready status.
2. **Agent action:** Agents tab with a concise prompt, the tool timeline, and the resulting selected/edited layer.
3. **Structured inspection:** the layer tree and inspector Code tab showing the selected node's generated Tailwind/React/HTML output.
4. **Reference workflow:** a local reference image beside the editable recreation scaffold.
5. **Export handoff:** the Export panel with format, revision, dimensions, byte size, checksum, and Download visible.

The project thumbnail should use the clean hero overview. The Devpost MCP can upload a project thumbnail; the Devpost gallery may still require selecting the remaining screenshots on the website.

## Submission Readiness Notes

- **Implementation:** code-verified; the registry contains 22 tools and the public tests cover the store, layout, export, WebMCP polyfill, agent protocol, persistence, and safety paths.
- **Automated verification:** `pnpm test` passed with 66 tests; `pnpm build` passed and produced the Vite bundle.
- **Live surface:** live browser verification shows the deployed page rendering and **WebMCP ready · 22** at the URL above. The live site has no app login.
- **Hackathon fit:** the project is a new, self-contained challenge edition created after the August 25 submission period opened, and its primary feature is a non-trivial WebMCP implementation.
- **Repository sync:** GitHub visibility is verified public (`gh repo view` reports `visibility: PUBLIC`). The remote `main` branch is one commit behind the prepared local checkout; pushing the current changes is still required before final submission.
- **Current upload blocker:** the demo video is not recorded yet. The Devpost form requires a public YouTube video under three minutes with audio.
- **Screenshot status:** live browser evidence is available; clean screenshots still need to be captured and attached to the Devpost project/gallery. A thumbnail upload can be handled once the project exists on Devpost.
- **Devpost status:** an older project named *Infinite Canvas — Agent Design Lab* already exists on the account, but this challenge edition is a separate codebase and should use its own Devpost project record. Nothing for this edition should be described as sent until Devpost confirms it.

## Known Limitations

- The challenge edition is intentionally smaller than the private Infinite Canvas product: no accounts, authentication, collaboration, cloud document storage, multi-page management, arbitrary external-page capture, Figma/import integrations, vector pen editing, WebGL effects, PDF/JSX export, advanced components, or experiment orchestration.
- The document is in-memory with browser persistence, not a multi-user backend. A browser reset or cleared storage removes local work.
- The deployed agent has a five-request-per-visitor quota and depends on a configured Vercel AI Gateway key. Local development bypasses that quota.
- Reference images are local and bounded in size. `recreate_from_reference` creates an editable scaffold; it does not infer a pixel-perfect design.
- WebMCP native support depends on the browser. The page uses a polyfill for development and browsers without native `document.modelContext` support; the judge should test in ChatGPT's in-app browser or Chrome with WebMCP enabled.
- Exports are deterministic for the reduced `DesignNode` model, not a full production design-file format. Stale `baseRevision` values are rejected rather than merged.

## TODO Official Form Fields

These values are from the live **The WebMCP Challenge** submission requirements and should be entered exactly in the Devpost form:

- **Submitter Type:** `Individual`
- **Country of residence:** `India`
- **App Status:** `New`
- **Live URL:** `https://webmcp-challenge.adityabrahmankar9.workers.dev/`
- **Testing instructions:** Use ChatGPT's in-app browser or Chrome with WebMCP enabled. No login. Confirm **WebMCP ready · 22**. Follow the numbered test flow above. The deployed Agents tab may consume one of the five visitor requests per prompt.
- **Public code repo:** `https://github.com/adityabrahmankar/infinite-canvas-webmcp-challenge` (visibility verified public; push the prepared local checkout before submission)
- **Agents/clients tested:** ChatGPT's in-app browser (live WebMCP surface), Google Chrome with WebMCP enabled, and the repository's in-page `document.modelContext` polyfill tests.
- **AI tools leveraged:** Codex for implementation/debugging/testing and the in-page agent through the Vercel AI Gateway with the configured Gemini/Muse modes.
- **Learning level:** `Significant`
- **Career AI value:** `Yes`
- **Organization name:** leave blank
- **Existing-project explanation:** leave blank because this challenge edition is new; do not describe the older private product as this submission.
- **Demo video URL:** add the public YouTube URL after recording (required; under three minutes with audio).
- **Codex session ID:** not requested by the live form; no value needed.

## Future Development (Clearly Separate From the Current Build)

If the project continues after the hackathon, the next useful steps are a real multi-user document backend with explicit conflict resolution, stronger artifact/version management, richer design primitives, accessible keyboard-first supervision, more robust agent evaluation, and provider-independent inference. Those are directions only; they are not part of the current submission claim.

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). You may use, modify, and redistribute the code, provided the license, copyright, attribution, and source link are retained.
