/** Shared by the popup and the keyboard-shortcut handler. */

export const STORAGE_KEY = 'profile';
export const SETTINGS_KEY = 'settings';

export async function loadStored() {
  const stored = await chrome.storage.sync.get([STORAGE_KEY, SETTINGS_KEY]);
  return {
    profile: stored[STORAGE_KEY] || {},
    settings: stored[SETTINGS_KEY] || {},
  };
}

export function hasAnyValue(profile) {
  const custom = Array.isArray(profile.customFields) ? profile.customFields : [];
  const plain = Object.keys(profile).some((key) => key !== 'customFields' && profile[key]);
  return plain || custom.some((f) => f.pattern && f.value);
}

function callInFrames(tabId, profile, options) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    args: [profile, options],
    func: (p, o) => (window.__jobApplierFill ? window.__jobApplierFill(p, o) : null),
  });
}

/**
 * Fills every frame of a tab, injecting a fresh content.js first so a
 * reloaded extension does not keep running stale code in open tabs.
 * Resolves to { fields, reverted, skipped } or throws with a readable message.
 * `reverted` lists fields the page cleared again after we wrote them;
 * `skipped` lists choice questions whose options matched nothing we hold.
 */
export async function fillTab(tab, profile, options) {
  if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) {
    throw new Error('Chrome does not allow extensions to run on this page.');
  }

  // Always inject first. Reloading the extension leaves the previous
  // content.js running in tabs that were already open, and a fresh injection
  // is what replaces it.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js'],
    });
  } catch (_) {
    /* already present, or a frame we may not touch */
  }

  const results = await callInFrames(tab.id, profile, options);

  const fields = results.flatMap((r) => (r.result ? r.result.fields : []));
  const reverted = results.flatMap((r) => (r.result && r.result.reverted ? r.result.reverted : []));
  const skipped = results.flatMap((r) => (r.result && r.result.skipped ? r.result.skipped : []));
  return { fields, reverted, skipped };
}
