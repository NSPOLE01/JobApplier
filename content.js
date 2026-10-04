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
  // "Company Email" asks for the employer's address, not yours.
  const ORG_CONTACT_EXCLUDE = [
    /(company|employer|organi[sz]ation|school|universit\w*|college)\s*(e-?mail|phone|tel|number|contact|fax)/i,
  ];
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
    { key: 'email', exclude: [...PERSON_EXCLUDE, ...ORG_CONTACT_EXCLUDE], patterns: [/e-?mail/i] },
    { key: 'phone', exclude: [...PERSON_EXCLUDE, ...ORG_CONTACT_EXCLUDE], patterns: [/phone/i, /mobile/i, /\bcell\b/i, /telephone/i, /\btel\b/i] },
    { key: 'firstName', exclude: PERSON_EXCLUDE, patterns: [/first\s*name/i, /given\s*name/i, /^\s*fname\s*$/i, /\bforename\b/i] },
    { key: 'lastName', exclude: PERSON_EXCLUDE, patterns: [/last\s*name/i, /\bsurname\b/i, /family\s*name/i, /^\s*lname\s*$/i] },
    { key: 'fullName', exclude: [...PERSON_EXCLUDE, /company\s*name/i, /school\s*name/i, /university/i, /file\s*name/i], patterns: [/full\s*name/i, /your\s*name/i, /^\s*name\s*$/i, /legal\s*name/i] },
    {
      key: 'currentCompany',
      exclude: [/company\s*(web\s*site|url|e-?mail|phone|address|size)/i, /which\s*company/i],
      patterns: [
        /current\s*(company|employer)/i,
        /most\s*recent\s*(company|employer)/i,
        /company\s*name/i,
        /employer\s*name/i,
        /^\s*company\s*$/i,
        /\bemployer\b/i,
        /^\s*organi[sz]ation\s*$/i,
      ],
    },
    {
      key: 'currentTitle',
      patterns: [
        /current\s*(title|role|position)/i,
        /most\s*recent\s*(title|role|position)/i,
        /job\s*title/i,
        /position\s*title/i,
        /^\s*title\s*$/i,
        /^\s*role\s*$/i,
        /occupation/i,
      ],
    },
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
    {
      key: 'gender',
      exclude: [/pronoun/i],
      patterns: [/\bgender\b/i, /gender\s*identity/i, /^\s*sex\s*$/i],
    },
    {
      key: 'hispanicLatino',
      patterns: [/hispanic/i, /latin[oax]/i],
    },
    {
      key: 'race',
      patterns: [/\brace\b/i, /\bracial\b/i, /ethnic(ity|\s*background|\s*group|\s*origin)/i],
    },
    {
      key: 'veteranStatus',
      patterns: [/veteran/i, /military\s*service/i, /protected\s*veteran/i],
    },
    { key: 'salary', patterns: [/salary/i, /compensation\s*(expectation|requirement)/i, /desired\s*pay/i] },
    { key: 'heardAbout', patterns: [/how\s*did\s*you\s*hear/i, /referral\s*source/i, /where\s*did\s*you\s*(hear|find)/i] },
  ];

  // Keys filled at most once per frame.
  const FILL_ONCE = new Set([
    'fullName', 'firstName', 'lastName', 'email', 'phone',
    'school', 'degree', 'discipline',
    'currentCompany', 'currentTitle',
    'gender', 'hispanicLatino', 'race', 'veteranStatus',
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
      // "Company Name *", "Title (required)" -> bare label, so anchored
      // patterns like /^title$/ still match a decorated label.
      const bare = spaced
        .replace(/\((?:[^)]*)\)/g, ' ')
        .replace(/\b(required|optional)\b/gi, ' ')
        .replace(/[*:•·,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (bare && bare !== spaced && bare !== text) parts.push(bare);
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

  function fire(el, event) {
    el.dispatchEvent(event);
  }

  function inputEvent(value) {
    if (typeof InputEvent === 'function') {
      return new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value,
      });
    }
    return new Event('input', { bubbles: true });
  }

  function focusEvent(type) {
    const Ctor = typeof FocusEvent === 'function' ? FocusEvent : Event;
    return new Ctor(type, { bubbles: type === 'focusin' || type === 'focusout' });
  }

  function setValueNative(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    // React remembers the last value it saw on the node. Clearing that first
    // is what makes it treat our write as a real change instead of a no-op.
    if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
      el._valueTracker.setValue('');
    }
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  /**
   * Write a value the way a person would, so framework state and validators
   * both see it: focus, type, input, change, blur. Pages that validate on
   * blur otherwise keep reporting a filled field as missing.
   */
  function typeInto(el, value) {
    // focus() fires trusted focus/focusin itself; only synthesize when the
    // element refuses focus, otherwise the page sees each event twice.
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      /* detached or non-focusable */
    }
    const focused = document.activeElement === el;
    if (!focused) fire(el, focusEvent('focusin'));

    // execCommand produces a trusted input event, which stubborn editors
    // believe. Where it is unavailable or blocked, fall back to the native
    // setter plus a synthetic input event.
    let typed = false;
    try {
      if (typeof el.select === 'function') el.select();
      typed = document.execCommand('insertText', false, value) && el.value === value;
    } catch (_) {
      typed = false;
    }

    if (!typed) {
      setValueNative(el, value);
      fire(el, inputEvent(value));
    }

    fire(el, new Event('change', { bubbles: true }));

    if (focused) {
      try {
        el.blur();
      } catch (_) {
        /* ignore */
      }
    } else {
      fire(el, focusEvent('focusout'));
    }
  }

  // "Decline to self identify" is worded differently by every ATS.
  const DECLINE = /decline|don'?t wish|do not wish|prefer not|choose not|rather not|not disclose|no\s*answer/i;

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function fillSelect(el, value) {
    const target = value.trim().toLowerCase();
    const options = Array.from(el.options || []).filter((o) => o.text.trim() || o.value);
    const norm = (s) => s.trim().toLowerCase();

    let hit = options.find((o) => norm(o.value) === target || norm(o.text) === target);

    // Whole-word containment either way, so "Male" never selects "Female"
    // and a long veteran option still matches a shorter stored phrase.
    if (!hit) {
      const targetRe = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i');
      hit = options.find((o) => {
        const text = norm(o.text);
        if (!text) return false;
        return targetRe.test(text) || new RegExp(`\\b${escapeRegExp(text)}\\b`, 'i').test(target);
      });
    }

    if (!hit && DECLINE.test(target)) hit = options.find((o) => DECLINE.test(o.text));
    if (!hit) return false;

    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      /* ignore */
    }
    const focused = document.activeElement === el;
    if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
      el._valueTracker.setValue('');
    }
    el.value = hit.value;
    fire(el, new Event('input', { bubbles: true }));
    fire(el, new Event('change', { bubbles: true }));

    if (focused) {
      try {
        el.blur();
      } catch (_) {
        /* ignore */
      }
    } else {
      fire(el, focusEvent('focusout'));
    }
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

  function readBack(el) {
    if (el.isContentEditable) return el.textContent;
    return el.value;
  }

  /**
   * Re-read what we wrote after the page has had a chance to react. A
   * controlled component that never registered the change reverts the node,
   * which is the difference between "filled" and "the form still wants it".
   */
  function verify(entries) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const stuck = [];
        const reverted = [];
        entries.forEach((entry) => {
          (readBack(entry.el) === entry.expected ? stuck : reverted).push(entry.label);
        });
        resolve({ stuck, reverted });
      }, 350);
    });
  }

  window.__jobApplierFill = async function fill(profile, options) {
    const opts = options || {};
    const customFields = Array.isArray(profile.customFields) ? profile.customFields : [];
    const candidates = Array.from(
      document.querySelectorAll('input, textarea, select, [contenteditable="true"]')
    );
    const entries = [];
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
        fire(el, inputEvent(String(value)));
        fire(el, new Event('change', { bubbles: true }));
      } else {
        typeInto(el, String(value));
      }

      flash(el, ok);
      if (!ok) continue;

      seenKeys.add(dedupeKey);
      entries.push({
        el,
        label: match.key === '__custom__' ? `custom (${value})` : match.key,
        expected: readBack(el),
      });
    }

    const { stuck, reverted } = await verify(entries);
    return { filled: stuck.length, fields: stuck, reverted };
  };
})();
