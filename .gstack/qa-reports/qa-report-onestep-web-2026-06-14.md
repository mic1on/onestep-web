# OneStep Web Rapid QA Report

Date: 2026-06-14
Target: http://127.0.0.1:5173/
Mode: rapid discovery
Health score: 82/100

## Summary

Automated checks are green:

- `pnpm --dir frontend test -- --run`: 31 passed
- `pnpm --dir frontend build`: passed
- `uv run pytest tests/test_exporter.py`: 2 passed, 1 warning

Browser checks covered node palette search, click-to-add, drag-to-canvas, focused node config, Escape close, Delete-key node removal, invalid Start, generated pipeline deletion, and mobile layout.

## Confirmed Working

- Node palette search works: searching `rabbit` narrows results to RabbitMQ Source and RabbitMQ Sink.
- Click-to-add works: Python Handler creates a canvas node.
- Drag-to-canvas works: Webhook Source dragged into the canvas creates a node.
- Focused node config no longer sits under `.builder-grid`; log overlap hits the dialog textarea, not the log panel.
- Escape closes the focused node config dialog.
- Delete key removes a selected node.
- Pipeline deletion works for the generated test pipeline and the test data was cleaned up.

## Findings

### ISSUE-001: Start is enabled on an invalid pipeline

Severity: High
Category: Functional / UX

Repro:

1. Open `New Pipeline`.
2. Add only `Webhook Source`.
3. Observe `Export` is disabled but `Start` is enabled.
4. Click `Start`.

Evidence:

- Before: `.gstack/qa-reports/screenshots/qa-invalid-draft-before-start.png`
- After: `.gstack/qa-reports/screenshots/qa-invalid-draft-after-start.png`
- API evidence: `POST /api/pipelines/.../start` returns `422`.
- UI log: `source node n1 requires at least one outgoing edge`.
- Browser console logs a failed resource for the 422.

Impact:

The editor already knows the graph is not exportable, but still lets the user attempt runtime start. This moves validation from edit-time to runtime logs and makes the control model inconsistent.

Recommendation:

Use the same graph validation for `Start` and `Export`. Disable `Start` for invalid graphs, or show an inline preflight panel with the exact missing edge/resource/config.

### ISSUE-002: Start failure leaves the top status stale until reload

Severity: Medium
Category: Functional / Feedback

Repro:

1. Follow ISSUE-001.
2. After the 422, observe the top status still shows the prior success message `Created pipeline`.
3. Reload later and the pipeline card can show `error`.

Evidence:

- `.gstack/qa-reports/screenshots/qa-invalid-draft-after-start.png`
- `.gstack/qa-reports/invalid-start-results.json`

Impact:

The user has to read the runtime log to know Start failed. The primary status area does not reflect the failed command immediately.

Recommendation:

When Start fails, update the command status and selected pipeline status immediately, not only after a later reload/log refresh.

### ISSUE-003: Pipeline Delete has no confirmation or undo

Severity: Medium
Category: Data safety / UX

Repro:

1. Select the generated test pipeline.
2. Click top-level `Delete`.
3. Pipeline is removed immediately.

Evidence:

- `.gstack/qa-reports/delete-generated-pipeline-results.json`
- `dialogs: []`
- `stillExistsAfter: false`

Impact:

Top-level pipeline deletion is destructive and currently easy to trigger. This is especially risky now that deletion exists in the main toolbar.

Recommendation:

Add confirmation with the pipeline name, or soft-delete with undo. Minimum version: `Delete "valid export"?` confirmation.

### ISSUE-004: Mobile runtime logs are unreadable

Severity: Medium
Category: Responsive UX

Repro:

1. Open app at `390x844`.
2. Select `valid export`.
3. Inspect bottom Pipeline logs.

Evidence:

- `.gstack/qa-reports/screenshots/qa-mobile-initial.png`

Impact:

Long error messages wrap word-by-word in a narrow column, making runtime debugging hard on narrow screens.

Recommendation:

Render logs as stacked cards on narrow screens, or set a desktop-only minimum width for the builder. If mobile support matters, log rows should become `time/status/source` header plus full-width message body.

## New Requirements

1. Validation-first Start flow
   - One preflight validator shared by Start and Export.
   - Canvas badges for missing incoming/outgoing edges.
   - A compact validation summary near the Start button.

2. Runtime log inspector
   - Filter by severity and node.
   - Clear/hide old logs for local demo runs.
   - Pin latest error and show it in the top status area.

3. Safer destructive actions
   - Confirm whole-pipeline deletion.
   - Add undo for the last pipeline/node delete.
   - Keep instant Delete-key behavior for selected canvas nodes, but show a short undo toast.

4. Demo cleanup/reset
   - Reset demo canvas and logs to a known state.
   - Remove old failed logs from local demo data without manual DB cleanup.

5. Narrow-screen policy
   - Either support a real mobile/narrow layout for logs and panels, or display a clear desktop-width requirement.

## Suggested Next Iteration

Fix ISSUE-001 and ISSUE-002 together. They share the same user path: pressing `Start` on an invalid graph. The right product behavior is edit-time preflight validation, not runtime failure discovery.

