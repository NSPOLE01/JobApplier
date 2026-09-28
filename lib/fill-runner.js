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
 * Fills every frame of a tab. Injects content.js first if the tab predates
 * the extension being installed or reloaded.
 * Resolves to { fields: string[] } or throws with a readable message.
 */
export async function fillTab(tab, profile, options) {
  if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) {
    throw new Error('Chrome does not allow extensions to run on this page.');
  }

  let results = await callInFrames(tab.id, profile, options);
  if (results.every((r) => r.result === null)) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js'],
    });
    results = await callInFrames(tab.id, profile, options);
  }

  const fields = results.flatMap((r) => (r.result ? r.result.fields : []));
  return { fields };
}
