# Process definitions

One strict `Process` object per YAML/JSON file. Processes link to the catalog's criteria, documents
and forms instead of duplicating them. Every process carries its own sources and `as_of`.

```yaml
id: example-process
benefit: ref:catalog/example-benefit
actor_roles: [subject, helper]
slots:
  - id: residence_confirmed
    type: boolean
    from_context: residence.confirmed
    question_hint: Liegt Ihr Wohnsitznachweis vor?
steps:
  - id: prepare
    needs: [residence_confirmed]
    documents: ref:catalog/example-benefit#documents
    action: documents.checklist
    on_complete: [process.nextStep]
    outputs:
      - id: checklist
        type: document
    reminders:
      - after_days: 7
        text_de: Unterlagen prüfen
    transitions:
      - to: finish
        when: residence_confirmed == true
  - id: finish
    needs: [prepare]
completion:
  evidence: [user_statement, artefact_built]
sources:
  - url: https://example.org/application
    quote: Anträge können bei der zuständigen Stelle eingebracht werden.
    retrieved_at: 2026-11-01T12:00:00Z
as_of: 2026-11-01
```

Slots have a unique `id`, `type` and required German `question_hint`; optional `from_context` names a
fact type. Types are `boolean`, `string`, `date`, `number`, `enum:<name>` or `fact:<factType>`.
Optional `validation` supports `required`, `min`, `max`, `min_length`, `max_length`, `pattern`,
`options`. Slot and step ids share a namespace. `needs` must reference an existing slot or another
step; transition targets must be existing steps. Each step can have `criteria` (`#criteria`),
`documents` (`#documents`), `form`, `action`, `signature` (`subject` or `none`), `on_complete` tool
names, `outputs`, `reminders` and `transitions`. Reminder `when` and transition `when` are optional
conditions. Completion evidence also accepts `document_present`.

An `action` names a registered server tool of the brain. The one exception is `goal.confirm`: it
marks the goal confirmation that the turn pipeline performs before `process.start`, and the engine
completes such a step from the confirmed goal instead of calling a tool.

Condition grammar: comparisons `== != < <= > >=`, dotted slot names, boolean/null/numeric/quoted
string literals, parentheses and `not`, `and`, `or` in that precedence order. Bare slots are valid.
No function calls, arithmetic or chained comparisons. Maximum expression length is 4096 characters.

This is the structural contract for the process engine. Evaluation, slot type resolution, transition selection,
completion semantics, scheduling and dependency-cycle semantics belong to the engine, not this
loader. Transition and output types may be extended there through an explicit contract change.
