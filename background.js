import { fillTab, hasAnyValue, loadStored } from './lib/fill-runner.js';

async function flashBadge(tabId, text, color) {
  await chrome.action.setBadgeBackgroundColor({ color, tabId });
  await chrome.action.setBadgeText({ text, tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 3000);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-page') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const { profile, settings } = await loadStored();
  if (!hasAnyValue(profile)) {
    await flashBadge(tab.id, '!', '#d97706');
    return;
  }

  try {
    const { fields, reverted } = await fillTab(tab, profile, { overwrite: Boolean(settings.overwrite) });
    const clean = fields.length > 0 && reverted.length === 0;
    await flashBadge(tab.id, String(fields.length), clean ? '#16a34a' : '#d97706');
  } catch (_) {
    await flashBadge(tab.id, '×', '#dc2626');
  }
});
