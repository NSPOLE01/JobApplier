import { SETTINGS_KEY, STORAGE_KEY, fillTab, hasAnyValue, loadStored } from './lib/fill-runner.js';

const statusEl = document.getElementById('status');
const savedEl = document.getElementById('saved');
const customRowsEl = document.getElementById('customRows');
const overwriteEl = document.getElementById('overwrite');

const fieldInputs = Array.from(document.querySelectorAll('[data-field]'));
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
    const { fields } = await fillTab(tab, profile, { overwrite: overwriteEl.checked });
    if (fields.length === 0) {
      setStatus('No matching fields found on this page.', 'warn');
      return;
    }
    const unique = [...new Set(fields.map(humanize))];
    setStatus(`Filled ${fields.length} field${fields.length === 1 ? '' : 's'}: ${unique.join(', ')}`, 'ok');
  } catch (error) {
    setStatus(error.message, 'err');
  }
}

fieldInputs.forEach((input) => input.addEventListener('input', scheduleSave));
overwriteEl.addEventListener('change', scheduleSave);
document.getElementById('addCustom').addEventListener('click', () => {
  customFields.push({ pattern: '', value: '' });
  renderCustomRows();
});
document.getElementById('fill').addEventListener('click', handleFill);

load();
