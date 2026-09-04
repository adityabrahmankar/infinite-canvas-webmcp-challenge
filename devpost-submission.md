# Infinite Canvas — WebMCP Challenge Edition

## One-line summary

A shared human+agent infinite canvas where WebMCP tools inspect, edit, and export one live document with the person keeping the final say.

## What is public

This submission is the self-contained challenge edition in `/Users/aditya/code/infinite-canvas-webmcp-challenge`. It is deliberately separate from the private/current project at `/Users/aditya/code/infinite-canvas`.

The public source keeps only the demo surface: seeded canvas, collapsible structured tree and selection, collapse-all control, dark/light editor chrome, basic text/style editing, create/move/resize/delete layers, mouse/trackpad/keyboard navigation, local reference image add/paste/drop, image inspection, editable reference recreation, undo/redo, deterministic PNG/SVG/HTML/project-JSON export, project JSON reopen, tests, and WebMCP registration.

The private product source is not required to build or judge this edition and must not be linked in the submission.

## What the demo proves

The agent reads structured state instead of guessing from screenshots. A local or pasted reference image can be inspected as image content and used to create an editable scaffold. Humans and agents share one document model with undo/redo. Export is deterministic and can reject a stale revision. Project JSON can be reopened after reset.

## Judge instructions

1. Open the deployed challenge URL in ChatGPT's in-app Browser.
2. Confirm `WebMCP ready · 18` in the footer.
3. Use the prompt from the repository README.
4. Verify structured layer tree edits, create/move/resize/delete, undo/redo, export receipts, downloaded artifacts, and project JSON reopen flow.

## Verification record

- Tests: run `pnpm test`.
- Production build: run `pnpm build`.
- Live URL: https://infinite-canvas-webmcp-challenge.adityabrahmankar9.workers.dev/
- Submission: not submitted. Public Git remote/commits still pending.

## Remaining submission work

- Publish only this reduced directory as the public repository.
- Add the public demo video and complete account-specific Devpost fields.
- Submit manually only after the source and deployment match.

## License

MIT — see [LICENSE](./LICENSE).
