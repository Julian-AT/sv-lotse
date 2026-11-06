# @lotse/ui

Shared React 19 components for the SV KI-Lotse workspace. Presentation and local UI interaction
live here; fetching, persistence, authorization, voice recognition and conversation state belong
to callers. No Next.js or provider dependency is required.

## Setup and tokens

Import the stylesheet once in the consuming app and components through the public export:

```tsx
import "@lotse/ui/styles.css";
import { Button, Field, TextInput, en, tokens, colorTokens } from "@lotse/ui";

<Field label={copy.name} hint={copy.nameHint}>
  <TextInput autoComplete="name" value={name} onChange={onNameChange} />
</Field>
<Button variant="primary" onClick={onContinue}>{copy.continue}</Button>
```

The stylesheet follows the system theme. Set `data-lotse-theme="light"` or
`data-lotse-theme="dark"` on the document's `html` element to override it, including portalled
Dialogs. Use `--lotse-canvas` and `--lotse-text` on the host page. Component styles are scoped with
`lotse-` classes and leave the host's element styles alone.

Tokens include body/heading fonts, five text sizes, four spacing sizes, three radii, two elevations,
focus width/offset/colour, motion duration/easing and the 44px target size. `tokens`, `colorTokens`,
`contrastPairs`, `Space` and `Theme` are exported for typed consumers. Headings use a restrained
system serif; body text uses system sans at 18px with a 1.6 line height. Theme colour pairs are
checked numerically at 4.5:1 for text and 3:1 for controls and focus indicators. Focus has a visible
3px outline; status text and border styles carry meaning alongside colour. Reduced-motion mode
removes animations and transitions; forced-colour mode preserves focus and selected-tab cues.

Edit `src/tokens/index.ts` or `src/styles/components.css`, then run
`bun run --filter @lotse/ui generate:styles`. Never edit the generated `src/styles.css` directly.
There is one public stylesheet entry, `@lotse/ui/styles.css`.

## Labels and content

German labels come from `de`; English labels come from `en`. Components with default copy accept
`labels?: Partial<Labels>`. Pass `labels={en}` to switch default labels, or override individual
keys. Set the host document's `lang` to match. Titles, values, hints, quotations and action content
come from caller props; keep them in the consuming feature's copy module or sourced data.

```tsx
<ApprovalCard {...approvalProps} labels={en} />
<Spinner labels={{ loading: copy.loading }} />
```

No medical advice or emergency contact list is generated here. `SafetyNotice` requires fixed,
reviewed text and contacts from the safety guard. Source quotations are displayed verbatim and
visibly separated. Dates are displayed as supplied with a semantic `time` element; callers supply
ISO dates rather than relying on the browser's time zone.

## Primitives

Examples use caller-owned `copy`, state and callbacks. All ordinary native attributes and React 19
`ref` props pass through the native-element wrappers. Buttons default to `type="button"` so a
composed card cannot accidentally submit a form.

| Component        | Usage                                                                               | Behaviour                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`         | `<Button variant="secondary" loading={pending} onClick={save}>{copy.save}</Button>` | `primary`, `secondary`, `ghost`, `danger`; loading disables activation and announces loading without hiding the action name.                                       |
| `IconButton`     | `<IconButton label={copy.close} onClick={close}>{icon}</IconButton>`                | Required accessible label; icon content is hidden from assistive technology.                                                                                       |
| `Link`           | `<Link href={url}>{copy.source}</Link>`                                             | Underlined 44px target; rejects executable schemes and protects a new-window opener. Supports HTTP(S), mail, telephone, anchor and explicit relative links.        |
| `Card`           | `<Card>{content}</Card>`                                                            | Neutral bordered surface; callers supply content semantics.                                                                                                        |
| `Stack`          | `<Stack gap="large">{content}</Stack>`                                              | Vertical layout; gap accepts `small`, `medium`, `large`, `xlarge`.                                                                                                 |
| `Inline`         | `<Inline gap="small">{actions}</Inline>`                                            | Wrapping horizontal layout; same gap scale.                                                                                                                        |
| `Heading`        | `<Heading level={2}>{copy.title}</Heading>`                                         | Native h1–h6; default h2. Choose a level matching the surrounding page.                                                                                            |
| `Text`           | `<Text tone="muted">{copy.hint}</Text>`                                             | Readable paragraph; optional muted tone.                                                                                                                           |
| `Badge`          | `<Badge tone="success">{copy.confirmed}</Badge>`                                    | Visible textual status; `info`, `success`, `warning`, `error`.                                                                                                     |
| `Tag`            | `<Tag onRemove={remove}>{copy.tag}</Tag>`                                           | Optional named, keyboard-operable removal button. Tag text must be a string.                                                                                       |
| `Alert`          | `<Alert tone="warning">{copy.warning}</Alert>`                                      | Textual severity label; warnings/errors use `alert`, information/success use `status`.                                                                             |
| `Dialog`         | `<Dialog open={open} title={copy.title} onClose={close}>{content}</Dialog>`         | Controlled portal to body; named modal, optional `description`, focus containment, background inertness, scroll lock, Escape, close button and opener restoration. |
| `Tooltip`        | `<Tooltip label={copy.help} content={copy.explanation} />`                          | Dedicated help button; hover/focus show supplemental plain text. Hovering the text keeps it open. Escape dismisses it before a containing dialog.                  |
| `Tabs`           | `<Tabs label={copy.view} items={tabs} value={tab} onValueChange={setTab} />`        | Items have `id`, `label`, `content`, optional `disabled`. Automatic activation, roving Tab stop, Left/Right wrapping and Home/End; disabled items are skipped.     |
| `Disclosure`     | `<Disclosure summary={copy.more}>{content}</Disclosure>`                            | Native details/summary keyboard interaction. Optional `open` and `onOpenChange`.                                                                                   |
| `Field`          | `<Field label={copy.name} hint={copy.hint} error={error}><TextInput /></Field>`     | One TextInput or Select per Field. Stable generated IDs connect label, hint and error. Put an explicit ID on Field when needed.                                    |
| `TextInput`      | `<TextInput aria-label={copy.search} value={query} onChange={change} />`            | Native input; use a Field or accessible name. Context merges extra descriptions and sets invalid state.                                                            |
| `Select`         | `<Field label={copy.language}><Select>{options}</Select></Field>`                   | Native select with Field wiring and native option children.                                                                                                        |
| `Checkbox`       | `<Checkbox label={copy.accept} checked={accepted} onChange={change} />`             | Native labelled choice; input and label have 44px targets. Standalone; group related choices in a fieldset/legend.                                                 |
| `Radio`          | `<Radio name="language" value={language} label={languageLabel} />`                  | Native exclusivity and keyboard behaviour. Related choices need a shared name and a fieldset/legend.                                                               |
| `Spinner`        | `<Spinner labels={labels} />`                                                       | Named loading status; decorative rotating mark becomes static under reduced motion.                                                                                |
| `Skeleton`       | `<Skeleton labels={labels} />`                                                      | Named loading status; no fake domain content. Reduced motion removes pulsing.                                                                                      |
| `VisuallyHidden` | `<VisuallyHidden>{copy.context}</VisuallyHidden>`                                   | Visually clipped text remains available to screen readers.                                                                                                         |

`Tabs` is uncontrolled when `value` is omitted (`defaultValue` is supported). With `value`, it emits
proposed selections and waits for the caller's value. IDs must be unique within a tab set. Hidden
panels remain mounted. Tab panel containers are keyboard stops so text-only content is reachable.
Tooltips contain no links or buttons; use Disclosure or Dialog for interactive explanations.

A Dialog initially focuses its close button; Tab and Shift+Tab stay inside, hidden/disabled elements
are excluded, and programmatic focus escapes are contained. Closing or unmounting restores the
opener if it still exists. Callback updates do not reset focus. The caller controls `open` and
must close it in response to `onClose`.

## Domain components

All domain components are props in, events out. In particular, approval and fact buttons do not
write facts or grant server authorization. Voice hints describe commands the workspace must wire
to the same decision handlers; these components do not access a microphone or listen globally.

`Citation` has `id`, `title`, `quote`, `url`, `asOf`, and optional `legalBasis`. Pass a stable unique
ID and the verbatim quote from a real source. Invalid link schemes render source text without a
navigable link. Source titles can include document/page locations supplied by the caller.

| Component            | Usage                                                                                                                             | Contract                                                                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CitationChip`       | `<CitationChip source={source} />`                                                                                                | Source title as a large link. The same source's quotation/date are available to WhyPanel.                                                                                                                                                                    |
| `ConversationBubble` | `<ConversationBubble speaker="assistant" text={text} streaming={streaming} citations={sources} />`                                | `user` or `assistant`; visible speaker label, preserved line breaks, polite assistant updates, busy state and source chips. Render streamed text updates through props.                                                                                      |
| `WhyPanel`           | `<WhyPanel sources={sources} confidence={confidence} unknowns={unknowns} />`                                                      | Source quotation, URL, as-of date, optional legal basis, confidence text and list of unknowns. No confidence is inferred locally.                                                                                                                            |
| `ApprovalCard`       | `<ApprovalCard title={title} changes={changes} provenance={sources} onApprove={approve} onDecline={decline} pending={pending} />` | Exact proposed changes and verbatim provenance; both decisions work through native keyboard activation. Pending disables both. Includes overridable keyboard/voice hints.                                                                                    |
| `FactCard`           | `<FactCard label={label} value={value} source={source} state={state} onConfirm={confirm} onEdit={edit} onReject={reject} />`      | `draft` exposes confirm/edit/reject; `confirmed` exposes edit/reject. State changes only when the caller updates props. Optional `pending` disables actions.                                                                                                 |
| `JourneyMap`         | `<JourneyMap steps={steps} />`                                                                                                    | Ordered steps: `id`, `title`, `status`, `owner`, optional `dueDate`. Status: `pending`, `current`, `completed`, `prepared`. Owner: `user`, `pilot`, `office`. A current step has `aria-current="step"`; prepared explicitly says it is waiting for the user. |
| `DocumentChecklist`  | `<DocumentChecklist items={documents} />`                                                                                         | Items: `id`, `title`, `status` (`have`, `missing`, `obtainable`), optional `where` and `source`. Callers supply where-to-obtain details whenever known, including missing items.                                                                             |
| `SafetyNotice`       | `<SafetyNotice title={fixedTitle} text={fixedText} contacts={contacts} />`                                                        | Each contact has `label` and `number`. Alert plus large `tel:` links. Fixed reviewed wording and official contact data come from props, never generated or embedded here.                                                                                    |
| `FormFieldOverlay`   | `<FormFieldOverlay label={label} value={value} state="draft" source={source} bounds={bounds} />`                                  | Place inside a positioned viewer page. Bounds `{ x, y, width, height }` are normalized fractions from the page's top-left. Draft is dashed; confirmed is solid; both have a textual state and source link.                                                   |

Change/unknown strings are treated as distinct entries; identical entries are displayed once.
Overlay content may extend beyond a small field box to keep text and source targets readable;
the viewer owns positioning, collision handling and page zoom. No business state is stored locally.

## Verification

Run from the repository root with Node.js 22+ on PATH:

```sh
bun run --filter @lotse/ui typecheck
bun run --filter @lotse/ui test
bun run --filter @lotse/ui check:styles
bunx --no-install biome check packages/ui
```

Vitest runs under Node with jsdom and Testing Library. The public-component catalogue tests rendering,
behaviour and axe for every component; a coverage assertion prevents an export being forgotten.
Axe's layout-dependent colour-contrast rule is unavailable in jsdom, so token tests compute WCAG
relative luminance and contrast independently for both themes. Target tests check computed CSS
minimum dimensions (jsdom does not measure painted geometry). Keyboard tests cover decisions,
modal focus containment/restoration, tooltips and tab navigation. A compiler-AST static check
rejects user-facing literals in component files, including variables and template strings.

Use real-browser visual/geometry checks and screen-reader checks when composing consuming screens;
component tests alone cannot certify a complete screen's WCAG conformance.

Implementation references: [React accessibility IDs](https://react.dev/reference/react/useId),
[React effect cleanup](https://react.dev/reference/react/useEffect), and the
[WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
