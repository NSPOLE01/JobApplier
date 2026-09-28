/**
 * JobApplier Autofill - content script.
 * Defines window.__jobApplierFill(profile, options) in the extension's
 * isolated world. The popup calls it through chrome.scripting.executeScript
 * for every frame in the active tab (ATS forms are often inside iframes).
 */
(() => {
  if (window.__jobApplierFillLoaded) return;
  window.__jobApplierFillLoaded = true;

  // Ordered most-specific first: whichever rule matches first wins.
  // `patterns` are tested against each text signal separately (so anchored
  // patterns like /^name$/ work); `exclude` is tested against all of them
  // joined, and vetoes the rule.
  const PERSON_EXCLUDE = [/referen|referr|emergency|supervisor|recruiter|manager's|previous\s*employer/i];
  const FIELD_RULES = [
    { key: 'github', patterns: [/git\s*-?hub/i] },
    { key: 'linkedin', patterns: [/linked\s*-?in/i] },
    { key: 'twitter', patterns: [/twitter/i, /\bx\.com\b/i, /\bx\s+(handle|profile|url)/i] },
    {
      key: 'portfolio',
      exclude: [/company\s*(web)?\s*site/i, /employer\s*(web)?\s*site/i, /company\s*url/i, /school|college|university/i, /job\s*post/i],
      patterns: [
        /portfolio/i,
        /personal\s*(web)?\s*site/i,
        /personal\s*url/i,
        /\bweb\s*site\b/i,
        /\bwebsite\b/i,
        /\bhomepage\b/i,
        /other\s*(website|url|link)/i,
        /^\s*url\s*$/i,
      ],
    },
    { key: 'email', exclude: PERSON_EXCLUDE, patterns: [/e-?mail/i] },
    { key: 'phone', exclude: PERSON_EXCLUDE, patterns: [/phone/i, /mobile/i, /\bcell\b/i, /telephone/i, /\btel\b/i] },
    { key: 'firstName', exclude: PERSON_EXCLUDE, patterns: [/first\s*name/i, /given\s*name/i, /^\s*fname\s*$/i, /\bforename\b/i] },
    { key: 'lastName', exclude: PERSON_EXCLUDE, patterns: [/last\s*name/i, /\bsurname\b/i, /family\s*name/i, /^\s*lname\s*$/i] },
    { key: 'fullName', exclude: [...PERSON_EXCLUDE, /company\s*name/i, /school\s*name/i, /university/i, /file\s*name/i], patterns: [/full\s*name/i, /your\s*name/i, /^\s*name\s*$/i, /legal\s*name/i] },
    { key: 'currentCompany', patterns: [/current\s*(company|employer)/i, /^\s*company\s*$/i, /\bemployer\b/i] },
    { key: 'currentTitle', patterns: [/current\s*(title|role|position)/i, /job\s*title/i, /^\s*title\s*$/i, /occupation/i] },
    {
      key: 'school',
      exclude: [/high\s*school/i, /(school|universit\w*|college)\s*(e-?mail|web\s*site|url|address|phone|link)/i],
      patterns: [/school/i, /universit/i, /college/i, /\binstitution\b/i, /alma\s*mater/i],
    },
    {
      key: 'degree',
      patterns: [/degree/i, /education\s*level/i, /level\s*of\s*education/i, /qualification/i],
    },
    {
      key: 'discipline',
      patterns: [/discipline/i, /\bmajor\b/i, /field\s*of\s*study/i, /course\s*of\s*study/i, /area\s*of\s*study/i, /concentration/i],
    },
    { key: 'address', patterns: [/street\s*address/i, /address\s*line\s*1/i, /^\s*address\s*$/i] },
    { key: 'city', patterns: [/\bcity\b/i, /\btown\b/i, /locality/i] },
    { key: 'state', patterns: [/\bstate\b/i, /province/i, /\bregion\b/i] },
    { key: 'zip', patterns: [/\bzip\b/i, /postal/i, /post\s*code/i] },
    { key: 'country', patterns: [/\bcountry\b/i] },
    { key: 'pronouns', patterns: [/pronoun/i] },
    { key: 'salary', patterns: [/salary/i, /compensation\s*(expectation|requirement)/i, /desired\s*pay/i] },
    { key: 'heardAbout', patterns: [/how\s*did\s*you\s*hear/i, /referral\s*source/i, /where\s*did\s*you\s*(hear|find)/i] },
  ];

  // Keys filled at most once per frame.
  const FILL_ONCE = new Set([
    'fullName', 'firstName', 'lastName', 'email', 'phone',
    'school', 'degree', 'discipline',
  ]);

  // Input types safe to type into. Checkboxes, radios, files and passwords are skipped.
  const FILLABLE_TYPES = new Set(['text', 'email', 'tel', 'url', 'search', '']);

  function isVisible(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.type === 'hidden') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const CONTROL_SELECTOR = 'input:not([type="hidden"]), textarea, select';

  function hasControl(node) {
    return node.matches?.(CONTROL_SELECTOR) || Boolean(node.querySelector?.(CONTROL_SELECTOR));
  }

  function countControls(node) {
    return node.querySelectorAll(CONTROL_SELECTOR).length;
  }

  function textOf(node) {
    if (!node) return '';
    const t = (node.innerText || node.textContent || '').trim();
    return t.length > 120 ? '' : t;
  }

  /** Collect every scrap of text that describes what a field wants. */
  function signalsFor(el) {
    const parts = [];
    const push = (v) => {
      if (!v) return;
      const text = String(v).trim();
      if (!text) return;
      parts.push(text);
      // job_application[school_name] -> "job application school name", so
      // patterns with word boundaries still match attribute names.
      const spaced = text.replace(/[_\-.[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (spaced && spaced !== text) parts.push(spaced);
    };

    if (el.id) {
      try {
        push(textOf(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)));
      } catch (_) {
        /* malformed id */
      }
    }
    push(textOf(el.closest('label')));

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => push(textOf(document.getElementById(id))));
    }

    push(el.getAttribute('aria-label'));
    push(el.getAttribute('placeholder'));
    push(el.getAttribute('name'));
    push(el.id);
    push(el.getAttribute('data-qa'));
    push(el.getAttribute('data-automation-id'));
    push(el.getAttribute('autocomplete'));

    // Text sitting immediately before the input.
    const prev = el.previousElementSibling;
    if (prev && !hasControl(prev)) push(textOf(prev));

    // Walk up through wrappers that hold this field alone. A container with
    // several inputs describes the group, not this field, so stop there --
    // otherwise the first label in a <form> leaks onto every field.
    let parent = el.parentElement;
    for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
      const tag = parent.tagName;
      if (tag === 'FORM' || tag === 'BODY' || tag === 'MAIN') break;
      if (countControls(parent) > 1) break;
      Array.from(parent.children).forEach((child) => {
        if (child === el || child.contains(el) || hasControl(child)) return;
        push(textOf(child));
      });
    }

    return parts;
  }

  function matchKey(parts, customFields) {
    const joined = parts.join(' | ');

    for (const custom of customFields) {
      if (!custom.pattern || !custom.value) continue;
      let hit = false;
      try {
        hit = new RegExp(custom.pattern, 'i').test(joined);
      } catch (_) {
        hit = joined.toLowerCase().includes(custom.pattern.toLowerCase());
      }
      if (hit) return { key: '__custom__', value: custom.value };
    }

    for (const rule of FIELD_RULES) {
      if (rule.exclude && rule.exclude.some((p) => p.test(joined))) continue;
      if (rule.patterns.some((p) => parts.some((part) => p.test(part)))) return { key: rule.key };
    }
    return null;
  }

  /** Set value in a way React / Vue controlled inputs actually notice. */
  function setValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillSelect(el, value) {
    const target = value.trim().toLowerCase();
    const options = Array.from(el.options || []);
    const exact = options.find(
      (o) => o.value.trim().toLowerCase() === target || o.text.trim().toLowerCase() === target
    );
    const partial =
      exact ||
      options.find((o) => {
        const t = o.text.trim().toLowerCase();
        return t && (t.includes(target) || target.includes(t));
      });
    if (!partial) return false;
    el.value = partial.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function flash(el, ok) {
    const previous = el.style.outline;
    el.style.outline = ok ? '2px solid #22c55e' : '2px solid #f59e0b';
    el.style.outlineOffset = '1px';
    setTimeout(() => {
      el.style.outline = previous;
    }, 1600);
  }

  window.__jobApplierFill = function fill(profile, options) {
    const opts = options || {};
    const customFields = Array.isArray(profile.customFields) ? profile.customFields : [];
    const candidates = Array.from(
      document.querySelectorAll('input, textarea, select, [contenteditable="true"]')
    );
    const filled = [];
    const seenKeys = new Set();

    for (const el of candidates) {
      if (el instanceof HTMLInputElement && !FILLABLE_TYPES.has(el.type)) continue;
      if (!isVisible(el)) continue;
      if (!opts.overwrite && el.value && el.value.trim()) continue;

      const signals = signalsFor(el);
      if (signals.length === 0) continue;

      const match = matchKey(signals, customFields);
      if (!match) continue;

      const value = match.key === '__custom__' ? match.value : profile[match.key];
      if (!value || !String(value).trim()) continue;

      // Some keys must not repeat down the page: a second education row is a
      // different school, not the same one again.
      const dedupeKey = match.key === '__custom__' ? `custom:${value}` : match.key;
      if (seenKeys.has(dedupeKey) && FILL_ONCE.has(match.key)) continue;

      let ok = true;
      if (el instanceof HTMLSelectElement) {
        ok = fillSelect(el, String(value));
      } else if (el.isContentEditable) {
        el.textContent = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        setValue(el, String(value));
      }

      flash(el, ok);
      if (ok) {
        seenKeys.add(dedupeKey);
        filled.push(match.key === '__custom__' ? `custom (${value})` : match.key);
      }
    }

    return { filled: filled.length, fields: filled };
  };
})();
