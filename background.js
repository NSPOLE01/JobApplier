import { fillTab, hasAnyValue, loadStored } from './lib/fill-runner.js';
import {
  API_URL,
  API_VERSION,
  buildRequestBody,
  describeApiError,
  parseAnswers,
} from './lib/claude.js';

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

/**
 * The API key lives here, in the service worker, and never reaches a page.
 * The browser-access header is required for a request whose origin is the
 * extension rather than a server.
 */
async function draftAnswers({ page, questions, profile, apiKey, model }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(buildRequestBody(page, questions, profile, model)),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(describeApiError(response.status, payload));
  return parseAnswers(payload);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'DRAFT_ANSWERS') return undefined;

  draftAnswers(message)
    .then((answers) => sendResponse({ ok: true, answers }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true; // keep the channel open for the async reply
});
