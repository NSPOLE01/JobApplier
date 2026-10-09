import { SETTINGS_KEY, STORAGE_KEY, fillTab, hasAnyValue, loadStored } from './lib/fill-runner.js';
import { DEFAULT_MODEL, MODELS } from './lib/claude.js';

const statusEl = document.getElementById('status');
const savedEl = document.getElementById('saved');
const customRowsEl = document.getElementById('customRows');
const overwriteEl = document.getElementById('overwrite');

const fieldInputs = Array.from(document.querySelectorAll('[data-field]'));
const localInputs = Array.from(document.querySelectorAll('[data-local]'));
const modelSelect = document.getElementById('model');
let customFields = [];
let saveTimer = null;

function readProfile() {
  const profile = {};
  fieldInputs.forEach((input) => {
    const value = input.value.trim();
    if (value) profile[input.dataset.field] = value;
  });
  profile.customFields = customFields.filter((f) => f.pattern.trim() && f.value.trim());
  return profile;
}

function saveLocal() {
  const local = {};
  localInputs.forEach((input) => {
    local[input.dataset.local] = input.value;
  });
  chrome.storage.local.set({ claude: local });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  savedEl.textContent = 'Saving...';
  saveTimer = setTimeout(async () => {
    await chrome.storage.sync.set({
      [STORAGE_KEY]: readProfile(),
      [SETTINGS_KEY]: { overwrite: overwriteEl.checked },
    });
    savedEl.textContent = 'Saved';
    setTimeout(() => {
      savedEl.textContent = 'Saved automatically';
    }, 1200);
  }, 300);
}

function renderCustomRows() {
  customRowsEl.textContent = '';
  customFields.forEach((field, index) => {
    const row = document.createElement('div');
    row.className = 'custom-row';

    const pattern = document.createElement('input');
    pattern.type = 'text';
    pattern.placeholder = 'keyword in label';
    pattern.value = field.pattern;
    pattern.addEventListener('input', () => {
      customFields[index].pattern = pattern.value;
      scheduleSave();
    });

    const value = document.createElement('input');
    value.type = 'text';
    value.placeholder = 'value to fill';
    value.value = field.value;
    value.addEventListener('input', () => {
      customFields[index].value = value.value;
      scheduleSave();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => {
      customFields.splice(index, 1);
      renderCustomRows();
      scheduleSave();
    });

    row.append(pattern, value, remove);
    customRowsEl.append(row);
  });
}

async function load() {
  MODELS.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    modelSelect.append(option);
  });

  const { claude } = await chrome.storage.local.get('claude');
  localInputs.forEach((input) => {
    const stored = claude && claude[input.dataset.local];
    if (stored) input.value = stored;
  });
  if (!modelSelect.value) modelSelect.value = DEFAULT_MODEL;

  const { profile, settings } = await loadStored();

  fieldInputs.forEach((input) => {
    if (profile[input.dataset.field]) input.value = profile[input.dataset.field];
  });
  overwriteEl.checked = Boolean(settings.overwrite);
  customFields = Array.isArray(profile.customFields) ? profile.customFields : [];
  renderCustomRows();
}

function humanize(key) {
  if (key.startsWith('custom')) return key;
  return key.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.className = `status ${tone || ''}`.trim();
}

async function handleFill() {
  const profile = readProfile();
  if (!hasAnyValue(profile)) {
    setStatus('Add your details above first.', 'warn');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  setStatus('Scanning page...');

  try {
    const { fields, reverted, skipped } = await fillTab(tab, profile, {
      overwrite: overwriteEl.checked,
    });

    if (fields.length === 0 && reverted.length === 0 && skipped.length === 0) {
      setStatus('No matching fields found on this page.', 'warn');
      return;
    }

    const unique = [...new Set(fields.map(humanize))];
    const summary = `Filled ${fields.length} field${fields.length === 1 ? '' : 's'}: ${unique.join(', ')}`;

    if (reverted.length) {
      const lost = [...new Set(reverted.map(humanize))];
      setStatus(`${fields.length ? `${summary}. ` : ''}The page cleared ${lost.join(', ')} — type ${reverted.length === 1 ? 'it' : 'those'} manually.`, 'warn');
      return;
    }

    if (skipped.length) {
      const unmatched = skipped
        .map((s) => `${humanize(s.key)} ("${s.value}")`)
        .join(', ');
      setStatus(`${fields.length ? `${summary}. ` : ''}No option matched ${unmatched}.`, 'warn');
      return;
    }

    setStatus(summary, 'ok');
  } catch (error) {
    setStatus(error.message, 'err');
  }
}

async function runInTab(tabId, fn, args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    args: args || [],
    func: fn,
  });
  return results.filter((r) => r.result);
}

async function handleDraft() {
  const profile = readProfile();
  const apiKey = localInputs.find((i) => i.dataset.local === 'apiKey').value.trim();
  if (!apiKey) {
    setStatus('Add your Anthropic API key below first.', 'warn');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) {
    setStatus('Chrome does not allow extensions to run on this page.', 'err');
    return;
  }

  setStatus('Reading the posting...');

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js'],
    });

    const scans = await runInTab(
      tab.id,
      (p) => (window.__jobApplierScanQuestions ? window.__jobApplierScanQuestions(p) : null),
      [profile]
    );

    // The frame holding the form is the one with questions in it.
    const frame = scans.find((r) => r.result.questions.length > 0);
    if (!frame) {
      setStatus('No open-ended questions found on this page.', 'warn');
      return;
    }

    const { page, questions } = frame.result;
    const pending = overwriteEl.checked ? questions : questions.filter((q) => !q.answered);
    if (pending.length === 0) {
      setStatus('Those questions already have answers.', 'warn');
      return;
    }

    setStatus(`Drafting ${pending.length} answer${pending.length === 1 ? '' : 's'}...`);

    const reply = await chrome.runtime.sendMessage({
      type: 'DRAFT_ANSWERS',
      page,
      questions: pending,
      profile,
      apiKey,
      model: modelSelect.value,
    });

    if (!reply || !reply.ok) {
      setStatus(reply ? reply.error : 'No response from the background worker.', 'err');
      return;
    }

    const written = await runInTab(
      tab.id,
      (answers, overwrite) =>
        window.__jobApplierWriteAnswers
          ? window.__jobApplierWriteAnswers(answers, { overwrite })
          : null,
      [reply.answers, overwriteEl.checked]
    );

    const count = written.reduce((total, r) => total + r.result.filled, 0);
    setStatus(
      count
        ? `Drafted ${count} answer${count === 1 ? '' : 's'}. Read them before submitting.`
        : 'Claude answered, but the page would not take the text.',
      count ? 'ok' : 'warn'
    );
  } catch (error) {
    setStatus(error.message, 'err');
  }
}

localInputs.forEach((input) => input.addEventListener('input', saveLocal));
modelSelect.addEventListener('change', saveLocal);
document.getElementById('draft').addEventListener('click', handleDraft);
fieldInputs.forEach((input) => input.addEventListener('input', scheduleSave));
overwriteEl.addEventListener('change', scheduleSave);
document.getElementById('addCustom').addEventListener('click', () => {
  customFields.push({ pattern: '', value: '' });
  renderCustomRows();
});
document.getElementById('fill').addEventListener('click', handleFill);

load();
