# JobApplier Autofill

A Chrome extension (Manifest V3) that fills job application forms with your details in one click.
Store your GitHub, LinkedIn, website, contact details and education once, then hit
**Fill this page** on any application form.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this folder.
3. Pin the extension, open the popup, and fill in your details. They save automatically.

## Use

- Click the toolbar icon, then **Fill this page**. Filled fields flash green.
- Or press **Cmd+Shift+Y** (**Ctrl+Shift+Y** on Windows/Linux) to fill without opening the popup.
  A badge on the icon shows how many fields were filled.
- **Cmd/Ctrl+Shift+U** opens the popup. Both shortcuts are editable at
  `chrome://extensions/shortcuts`.

A fresh copy of the content script is injected on every fill, so reloading the extension at
`chrome://extensions` is enough to pick up changes; open tabs do not need a refresh.

By default, fields that already have a value are left alone. Tick **Overwrite fields that already
have a value** to replace them.

## How matching works

`content.js` looks at every visible text, email, tel, url, textarea and select field in the page
and in every iframe, since most applicant tracking systems embed their form in one. For each field
it collects the associated `<label>`, `aria-label`, `aria-labelledby`, placeholder, `name`, `id`,
`data-qa` / `data-automation-id`, `autocomplete`, and nearby wrapper text, then matches that
against an ordered rule table.

Two details that matter in practice:

- Rules are ordered most specific first, so a "GitHub URL" field is never treated as a generic
  website field.
- Some rules carry exclusions. "Company Website" does not get your portfolio, and "Reference Email"
  does not get your email address.

Values are written through the native `value` setter and followed by `input` and `change` events,
so React and Vue controlled forms register the change rather than reverting on submit.

## Phone country code

Application forms often put a "Country" dropdown next to the phone box. That one wants the dialing
code, not the country name, so it is detected by its options rather than its label: a select whose
options read like "United States +1", "US (+1)" or plain "+1" is treated as a phone country picker
even when it is labeled "Country" or carries no label at all. Address country fields are unaffected
and still receive the country name.

The code comes from the **Phone country code** field in the popup if you set one. Otherwise it is
derived from your phone number when that starts with a `+`, and failing that from your country. When
several options share a code, as the US and Canada both do with +1, the one naming your country is
chosen.

## Voluntary self-identification

Gender, Hispanic or Latino, race, and veteran status are dropdowns in the popup, left blank by
default.
Blank means the question is skipped, so these are filled only if you choose to set them.

These questions are not always dropdowns. When they are radio buttons, an ARIA radiogroup, or a row
of clickable buttons, the extension finds the group, reads the question from its legend, heading or
surrounding text, and clicks the option matching your answer. Only these four questions and your own
custom fields are ever answered by clicking, so an unrelated question like "Are you willing to
relocate?" is left alone. Buttons that submit are never clicked: a plain `<button>` defaults to
submit, so only explicit `type="button"` options, `role="radio"`, and `role="button"` elements are
eligible.

Sites commonly hide the real `<input type="radio">` behind a styled label, using `opacity: 0`,
`display: none` or a 1x1 box, so an option counts as present when either the input or its label is
visible, and the click lands on the label when the input itself is hidden. If a question is
recognised but none of its options match your answer, the popup says so by name rather than failing
quietly.

Because every applicant tracking system words these options differently, select matching tries an
exact option match, then whole-word matching in either direction, then a decline-shaped fallback.
That is how a stored "I am not a protected veteran" finds an option reading "No, I am not a
protected veteran", how "Asian" finds "Asian (Not Hispanic or Latino)", and why "Male" never selects
"Female". Race and Hispanic or Latino stay separate questions, each answered only from its own
field.

## Open-ended answers with Claude

Questions like "Why do you want to work here?" cannot come from a saved profile, so the popup has a
second button, **Draft open-ended answers**. It finds the free-text boxes the profile rules do not
claim, reads the company, role and job posting off the page, sends those along with your background
notes to the Claude API, and writes a two-sentence answer into each box.

Setup is three fields in the popup's **Claude drafting** section: your Anthropic API key, a model,
and **About you**. That last one matters most. Claude is instructed never to invent an employer, a
date, a metric or a project, so the only specifics it can use are the ones you write there. With it
blank, the answers are honest but generic.

The system prompt bans the usual tells: no "excited", "passionate", "align" or "leverage", no em
dashes, no exclamation marks, no opening flattery. Answers come back through a JSON schema, so each
one lands in the box it belongs to.

**Defaults and costs.** The model defaults to Claude Opus 5.5 for the best writing, with Sonnet 5.5
and Haiku 4.5 in the dropdown if you would rather pay less. A page of questions costs roughly a cent
on Opus, less on the others. Effort is set to low, since two sentences do not need deep reasoning,
and refusal fallbacks are enabled so a declined request is retried on another model inside the same
call.

**Where the key lives.** In `chrome.storage.local`, so it stays on this machine and is never synced
like the rest of your profile. API calls are made from the extension's service worker, so the key is
never exposed to the page or to the content script.

Answers are drafts. Read them before you submit: the popup says so every time it finishes, and
nothing is ever submitted for you.

## Custom fields

The popup's **Custom fields** section maps any keyword to any value. The keyword is matched against
the same signals described above, and is treated as a regular expression when it is a valid one.
Custom fields take priority over the built-in rules, so they also let you override a built-in match.

Example: keyword `authorized to work` with value `Yes`.

## "The field is filled but the form says it is missing"

Modern application forms do not read the text box when you submit. They read their own JavaScript
state, which is updated by the events a real keystroke produces. Writing `element.value` alone
changes what you see and nothing else, so validation still considers the field empty.

The extension writes values the way a person does: it focuses the field, types through
`execCommand('insertText')` so the page receives a trusted input event, falls back to the native
value setter with a synthetic `input` event when that is blocked, then fires `change` and blurs the
field, since many forms validate on blur. For React specifically it clears the node's internal
`_valueTracker` first, which is what makes React treat the write as a real change rather than a
no-op.

After filling, it waits a moment and re-reads every field. Any field the page cleared again is
reported in the popup as cleared rather than counted as filled, so a silent rejection shows up
immediately instead of at submit time.

## Tests

Field matching is covered by a jsdom suite with fixtures shaped like Greenhouse, Lever, Ashby and
Workday forms, plus false-positive guards.

```bash
npm install
npm test
```

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, permissions, keyboard commands |
| `content.js` | Field detection and filling, runs in every frame |
| `lib/fill-runner.js` | Shared logic: load profile, inject, run across frames |
| `popup.html` / `popup.css` / `popup.js` | Profile editor and Fill button |
| `background.js` | Keyboard shortcut, badge feedback, and Claude API calls |
| `lib/claude.js` | Prompt building, request shape, response parsing |
| `tests/run.mjs` | jsdom tests for the matching rules |

## Notes and limits

- Your profile lives in `chrome.storage.sync`, so it follows your Chrome profile across devices and
  never leaves Google's sync. The extension makes no network requests.
- Resume file uploads are not handled. Chrome extensions cannot set a file input's value.
- Custom dropdowns built from `div` elements rather than `select` are not filled.
- Race questions asked as a checkbox group rather than a dropdown or radio group are not filled,
  since the answer can be several boxes.
- Education is filled for one entry only. If a form has several school rows, the first is filled and
  the rest are left for you, since they are different schools.
