# Template review

`reviewTemplate(db, authenticatedUserId, templateId, input)` accepts
`{ formInstanceId, fields }`. Each field contains `id`, `label_de`, `type`, `owner`,
and a displayed CropBox `box` (top-left PDF points, one-based page). The HTTP host
exposes this through `PATCH /api/forms/templates/:id` with session and origin checks.
A persisted subject actor for the instance's case is required; helper scope does not
permit review. Fact mappings and validation metadata come from the stored schema.

Review validates every box against the real original PDF and creates an immutable
`verified` template row. The existing source/hash uniqueness is preserved using a
`#lotse-review=<version UUID>` source fragment. `schema.assetSource` retains the
original source, and `schema.review.previousTemplateId` links versions. The asset hash,
storage key and publication date are unchanged. No asset is copied or model called.
Analysis never overwrites reviewed versions.

Only the reviewed instance switches versions. Its values return to draft and its cached
output is invalidated, so value approval is required again. Other instances keep their
original version. New prefills can explicitly use the returned template id. Moved or
resized native fields lose their native widget binding so PDF output uses the reviewed
box. Export also rechecks the template id after rendering.

The viewer's review mode supports drag/resize/draw, individual field confirmation,
arrow keys to move, Shift + arrow keys to resize, and labeled numeric controls and an
Add field button for equivalent keyboard operation. All fields must be confirmed before
saving; editing a field revokes its confirmation.

Verification from the repository root (no live providers):

```sh
bun run --filter @lotse/web test -- test/form-review.test.ts test/form-review-route.test.ts
bun run --filter @lotse/brain test:forms:integration
bun run typecheck
bun run --filter @lotse/knowledge e2:scan
```

Registry DB tests use real original PDF widgets with test-only administrative mappings,
an isolated Postgres database and real MinIO for the generated package.
