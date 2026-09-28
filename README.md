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

## Custom fields

The popup's **Custom fields** section maps any keyword to any value. The keyword is matched against
the same signals described above, and is treated as a regular expression when it is a valid one.
Custom fields take priority over the built-in rules, so they also let you override a built-in match.

Example: keyword `authorized to work` with value `Yes`.

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
| `background.js` | Keyboard shortcut handler and badge feedback |
| `tests/run.mjs` | jsdom tests for the matching rules |

## Notes and limits

- Your profile lives in `chrome.storage.sync`, so it follows your Chrome profile across devices and
  never leaves Google's sync. The extension makes no network requests.
- Resume file uploads are not handled. Chrome extensions cannot set a file input's value.
- Custom dropdowns built from `div` elements rather than `select` are not filled.
- Education is filled for one entry only. If a form has several school rows, the first is filled and
  the rest are left for you, since they are different schools.
