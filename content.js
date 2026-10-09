/**
 * JobApplier Autofill - content script.
 * Defines window.__jobApplierFill(profile, options) in the extension's
 * isolated world. The popup calls it through chrome.scripting.executeScript
 * for every frame in the active tab (ATS forms are often inside iframes).
 */
(() => {
  // Deliberately no load guard: re-injecting replaces this definition, which
  // is how a reloaded extension reaches tabs that were already open.

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
    {
      key: 'phone',
      exclude: [...PERSON_EXCLUDE, ...ORG_CONTACT_EXCLUDE, /(country|dial(ing)?|calling)\s*code/i],
      patterns: [/phone/i, /mobile/i, /\bcell\b/i, /telephone/i, /\btel\b/i],
    },
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
    {
      key: 'phoneCountry',
      patterns: [/(country|dial(ing)?|calling)\s*code/i, /phone\s*country/i, /country\s*dial/i],
    },
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

  function textOf(node, max = 120) {
    if (!node) return '';
    const t = (node.innerText || node.textContent || '').trim();
    return t.length > max ? '' : t;
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

    // el.labels covers both <label for> and a wrapping label, with no need to
    // build a selector out of an id that may contain anything.
    const labels = el.labels ? Array.from(el.labels) : [];
    labels.forEach((label) => push(textOf(label)));
    if (labels.length === 0 && el.id) {
      const byFor = Array.from(document.querySelectorAll('label[for]')).find(
        (label) => label.htmlFor === el.id
      );
      push(textOf(byFor));
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

  function commitSelect(el, option) {
    if (!option) return false;
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      /* ignore */
    }
    const focused = document.activeElement === el;
    if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
      el._valueTracker.setValue('');
    }
    el.value = option.value;
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

  // Phone country pickers list dialing codes -- "United States +1", "US (+1)",
  // plain "+1" -- and are labeled "Country" as often as not. The right answer
  // there is +1, never "United States", so they are detected by their options.
  const COUNTRY_DIAL = {
    'united states': ['1', 'us'],
    'united states of america': ['1', 'us'],
    usa: ['1', 'us'],
    us: ['1', 'us'],
    canada: ['1', 'ca'],
    'united kingdom': ['44', 'gb'],
    uk: ['44', 'gb'],
    'great britain': ['44', 'gb'],
    ireland: ['353', 'ie'],
    india: ['91', 'in'],
    australia: ['61', 'au'],
    'new zealand': ['64', 'nz'],
    germany: ['49', 'de'],
    france: ['33', 'fr'],
    spain: ['34', 'es'],
    italy: ['39', 'it'],
    netherlands: ['31', 'nl'],
    sweden: ['46', 'se'],
    switzerland: ['41', 'ch'],
    poland: ['48', 'pl'],
    mexico: ['52', 'mx'],
    brazil: ['55', 'br'],
    japan: ['81', 'jp'],
    china: ['86', 'cn'],
    singapore: ['65', 'sg'],
    israel: ['972', 'il'],
    'south africa': ['27', 'za'],
  };

  const KNOWN_DIALS = new Set(Object.values(COUNTRY_DIAL).map(([dial]) => dial));

  function lookupCountry(name) {
    if (!name) return null;
    const key = String(name).trim().toLowerCase().replace(/[.]/g, '');
    return COUNTRY_DIAL[key] || null;
  }

  function dialCodeOf(option) {
    const fromText = String(option.text).match(/\+\s*(\d{1,4})/);
    if (fromText) return fromText[1];
    const fromValue = String(option.value).match(/^\+?(\d{1,4})$/);
    return fromValue ? fromValue[1] : null;
  }

  function isDialCodeSelect(el) {
    const options = Array.from(el.options || []);
    if (options.length < 2) return false;
    const coded = options.filter((o) => /\+\s*\d{1,4}/.test(o.text));
    return coded.length >= 2 && coded.length >= options.length / 2;
  }

  /** Digits only: the explicit setting, else the phone's prefix, else the country. */
  function dialCodeFor(profile) {
    const explicit = String(profile.phoneCountryCode || '').replace(/\D/g, '');
    if (explicit) return explicit;

    const phone = String(profile.phone || '').trim();
    if (phone.startsWith('+')) {
      const digits = phone.slice(1).replace(/\D/g, '');
      for (let len = 3; len >= 1; len -= 1) {
        if (KNOWN_DIALS.has(digits.slice(0, len))) return digits.slice(0, len);
      }
    }

    const country = lookupCountry(profile.country);
    return country ? country[0] : null;
  }

  function fillDialSelect(el, code, countryName) {
    const matches = Array.from(el.options || []).filter((o) => dialCodeOf(o) === code);
    if (matches.length === 0) return false;

    // +1 is both the US and Canada, so prefer the option naming your country.
    const country = lookupCountry(countryName);
    const name = String(countryName || '').trim().toLowerCase();
    const preferred =
      (name && matches.find((o) => o.text.toLowerCase().includes(name))) ||
      (country && matches.find((o) => String(o.value).toLowerCase() === country[1])) ||
      matches[0];

    return commitSelect(el, preferred);
  }

  // "Decline to self identify" is worded differently by every ATS.
  const DECLINE = /decline|don'?t wish|do not wish|prefer not|choose not|rather not|not disclose|no\s*answer/i;

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * The shared matching ladder for anything with a fixed set of answers:
   * exact, then whole-word containment either way, then a decline-shaped
   * fallback. Whole-word is what stops "Male" selecting "Female".
   */
  function pickOption(items, value) {
    const target = String(value).trim().toLowerCase();
    const norm = (s) => String(s || '').trim().toLowerCase();

    let hit = items.find((item) => norm(item.value) === target || norm(item.text) === target);

    if (!hit) {
      const targetRe = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i');
      hit = items.find((item) => {
        const text = norm(item.text);
        if (!text) return false;
        return targetRe.test(text) || new RegExp(`\\b${escapeRegExp(text)}\\b`, 'i').test(target);
      });
    }

    if (!hit && DECLINE.test(target)) hit = items.find((item) => DECLINE.test(item.text));
    return hit || null;
  }

  function fillSelect(el, value) {
    const items = Array.from(el.options || [])
      .filter((o) => o.text.trim() || o.value)
      .map((o) => ({ ref: o, text: o.text, value: o.value }));
    const hit = pickOption(items, value);
    return hit ? commitSelect(el, hit.ref) : false;
  }

  function flash(el, ok) {
    const previous = el.style.outline;
    el.style.outline = ok ? '2px solid #22c55e' : '2px solid #f59e0b';
    el.style.outlineOffset = '1px';
    setTimeout(() => {
      el.style.outline = previous;
    }, 1600);
  }

  // --- choice questions ------------------------------------------------------
  // Gender, race and veteran status are often radio buttons or a row of
  // clickable buttons rather than a dropdown. Only these keys are answered by
  // clicking, plus custom fields, where you supplied the exact wording.
  const CHOICE_KEYS = new Set(['gender', 'hispanicLatino', 'race', 'veteranStatus']);

  // No bare <button>: its type defaults to submit, and a stray click there
  // would send a half-finished application.
  const CHOICE_OPTION_SELECTOR =
    'input[type="radio"], [role="radio"], button[type="button"], [role="button"], [aria-pressed]';

  function labelsOf(el) {
    return el.labels ? Array.from(el.labels) : [];
  }

  /**
   * Styled radio groups hide the real <input> (opacity:0, display:none, or a
   * 1x1 box) and show a label instead, so the input's own box says nothing
   * about whether the option is on screen.
   */
  function isChoiceVisible(el) {
    if (el.disabled) return false;
    if (isVisible(el)) return true;
    if (labelsOf(el).some(isVisible)) return true;
    const wrapper = el.parentElement;
    return Boolean(wrapper && wrapper !== document.body && isVisible(wrapper));
  }

  /** Click where a person would: the label, when the input itself is hidden. */
  function clickTarget(el) {
    if (isVisible(el)) return el;
    return labelsOf(el).find(isVisible) || el;
  }

  function isChoiceOption(el) {
    if (!el.matches || !el.matches(CHOICE_OPTION_SELECTOR)) return false;
    if (el.type === 'submit' || el.type === 'reset') return false;
    return !el.disabled;
  }

  function choiceOptions(root) {
    return Array.from(root.querySelectorAll(CHOICE_OPTION_SELECTOR)).filter(isChoiceOption);
  }

  /** The element that holds a whole question's options. */
  function optionContainer(el) {
    const named = el.closest('[role="radiogroup"], [role="group"], fieldset');
    if (named) return named;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
      if (choiceOptions(node).length >= 2) return node;
    }
    return el.parentElement;
  }

  function optionText(el) {
    if (el.labels && el.labels.length) {
      const fromLabels = Array.from(el.labels)
        .map((label) => textOf(label, 200))
        .filter(Boolean)
        .join(' ')
        .trim();
      if (fromLabels) return fromLabels;
    }
    const own = textOf(el, 200);
    if (own) return own;
    return el.getAttribute('aria-label') || el.value || '';
  }

  /** What the question is asking, gathered from around the option group. */
  function groupSignals(container, sample) {
    const parts = [];
    const push = (v) => {
      if (!v) return;
      const text = String(v).trim();
      if (!text) return;
      parts.push(text);
      const spaced = text.replace(/[_\-.[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (spaced && spaced !== text) parts.push(spaced);
    };

    push(textOf(container.querySelector('legend'), 400));
    push(container.getAttribute('aria-label'));
    const labelledBy = container.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => push(textOf(document.getElementById(id), 400)));
    }
    push(sample.getAttribute('name'));
    push(container.getAttribute('data-automation-id'));

    // Text inside the group that is not one of the options, such as a heading.
    Array.from(container.children).forEach((child) => {
      if (isChoiceOption(child) || choiceOptions(child).length) return;
      push(textOf(child, 400));
    });

    // Text just before the group, which is where the question usually sits.
    let node = container;
    for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
      let prev = node.previousElementSibling;
      for (let back = 0; prev && back < 2; back += 1, prev = prev.previousElementSibling) {
        if (choiceOptions(prev).length) continue;
        push(textOf(prev, 400));
      }
    }

    return parts;
  }

  function choiceState(el) {
    if (el.type === 'radio') return el.checked ? 'on' : 'off';
    const checked = el.getAttribute('aria-checked');
    if (checked !== null) return checked;
    const pressed = el.getAttribute('aria-pressed');
    if (pressed !== null) return pressed;
    return 'unknown';
  }

  function isChosen(el) {
    const state = choiceState(el);
    return state === 'on' || state === 'true';
  }

  function clickOption(el) {
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      /* ignore */
    }
    if (el.type !== 'radio') {
      // Some option widgets act on mousedown rather than click.
      ['mousedown', 'mouseup'].forEach((type) => {
        if (typeof MouseEvent === 'function') {
          fire(el, new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
        }
      });
    }
    if (typeof el.click === 'function') el.click();
    else if (typeof MouseEvent === 'function') {
      fire(el, new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    }
  }

  /** Answer radio and button questions. Mutates seenKeys and entries. */
  function fillChoiceGroups(ctx) {
    const { profile, customFields, opts, seenKeys, entries, skipped } = ctx;
    const groups = new Map();

    choiceOptions(document).forEach((el) => {
      if (!isChoiceVisible(el)) return;
      const container = optionContainer(el);
      if (!container) return;
      if (!groups.has(container)) groups.set(container, []);
      groups.get(container).push(el);
    });

    groups.forEach((options, container) => {
      if (options.length < 2) return;

      const match = matchKey(groupSignals(container, options[0]), customFields);
      if (!match) return;
      if (match.key !== '__custom__' && !CHOICE_KEYS.has(match.key)) return;

      const value = match.key === '__custom__' ? match.value : profile[match.key];
      if (!value || !String(value).trim()) return;

      const dedupeKey = match.key === '__custom__' ? `custom:${value}` : match.key;
      if (seenKeys.has(dedupeKey) && FILL_ONCE.has(match.key)) return;
      if (!opts.overwrite && options.some(isChosen)) return;

      const items = options.map((el) => ({ ref: el, text: optionText(el), value: el.value || '' }));
      const hit = pickOption(items, String(value));
      if (!hit) {
        skipped.push({ key: match.key, value: String(value) });
        return;
      }

      const target = clickTarget(hit.ref);
      clickOption(target);
      flash(target, true);
      seenKeys.add(dedupeKey);
      entries.push({
        label: match.key === '__custom__' ? `custom (${value})` : match.key,
        read: () => choiceState(hit.ref),
        expected: choiceState(hit.ref),
      });
    });
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
          (entry.read() === entry.expected ? stuck : reverted).push(entry.label);
        });
        resolve({ stuck, reverted });
      }, 350);
    });
  }

  // --- open-ended questions --------------------------------------------------
  // Free-text questions ("Why do you want to work here?") are answered by
  // Claude rather than from the profile, so they are collected, not filled.

  function metaContent(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = node && (node.getAttribute('content') || node.textContent);
      if (value && value.trim()) return value.trim();
    }
    return '';
  }

  function companyName() {
    const meta = metaContent(['meta[property="og:site_name"]', 'meta[name="application-name"]']);
    if (meta) return meta;

    // Greenhouse and Lever put the company in the title: "Role at Company".
    const title = document.title || '';
    const atCompany = title.match(/\bat\s+([^|\-\u2013]+)$/i);
    if (atCompany) return atCompany[1].trim();

    const host = location.hostname.replace(/^www\./, '');
    const embedded = host.match(/^(?:boards|jobs|job-boards|apply|careers)\.(?:greenhouse|lever|ashbyhq|workable)\.io$/);
    if (!embedded) {
      const bare = host.split('.')[0];
      if (bare && bare.length > 2) return bare;
    }
    return title.split(/[|\-\u2013]/)[0].trim();
  }

  function roleName() {
    const heading = document.querySelector('h1, [class*="posting-headline"] h2, [class*="job-title"]');
    const text = textOf(heading, 200);
    if (text) return text;
    return metaContent(['meta[property="og:title"]']) || (document.title || '').split(/[|\-\u2013]/)[0].trim();
  }

  /** The posting text, without the form itself or the site chrome. */
  function postingText() {
    const scopes = [
      document.querySelector('[class*="job-description"], [class*="posting-description"], [id*="job-description"]'),
      document.querySelector('main'),
      document.body,
    ];
    let best = '';
    for (const scope of scopes) {
      if (!scope) continue;
      const clone = scope.cloneNode(true);
      clone
        .querySelectorAll('script, style, nav, header, footer, form, input, textarea, select, button')
        .forEach((node) => node.remove());
      const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
      // A specific container wins outright; otherwise keep the fullest text.
      if (text.length > 400) return text.slice(0, 8000);
      if (text.length > best.length) best = text;
    }
    return best.length > 40 ? best.slice(0, 8000) : '';
  }

  function pageContext() {
    return {
      company: companyName(),
      role: roleName(),
      url: location.href,
      description: postingText(),
    };
  }

  function questionTextFor(el) {
    const signals = signalsFor(el);
    // The longest signal is the question; attribute names are the short ones.
    return signals
      .map((part) => part.trim())
      .filter((part) => part.length > 12 && /\s/.test(part))
      .sort((a, b) => b.length - a.length)[0] || '';
  }

  /**
   * An open-ended box is a textarea (or rich-text area) that the profile
   * rules do not claim and whose label reads like a question.
   */
  function isOpenEnded(el, customFields) {
    if (!(el instanceof HTMLTextAreaElement) && !el.isContentEditable) return false;
    if (!isVisible(el)) return false;

    const signals = signalsFor(el);
    if (signals.length === 0) return false;
    if (matchKey(signals, customFields)) return false;

    const question = questionTextFor(el);
    if (!question) return false;
    // Resumes and cover letters pasted wholesale are not two-sentence answers.
    return !/resume|cv\b|cover\s*letter/i.test(question);
  }

  window.__jobApplierScanQuestions = function scanQuestions(profile) {
    const customFields = Array.isArray(profile && profile.customFields) ? profile.customFields : [];
    const questions = [];

    Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')).forEach((el, index) => {
      if (!isOpenEnded(el, customFields)) return;

      const id = el.getAttribute('data-jobapplier-qid') || `q${index}`;
      el.setAttribute('data-jobapplier-qid', id);

      const maxAttr = Number(el.getAttribute('maxlength'));
      questions.push({
        id,
        question: questionTextFor(el),
        maxLength: Number.isFinite(maxAttr) && maxAttr > 0 ? maxAttr : null,
        answered: Boolean((el.value || el.textContent || '').trim()),
      });
    });

    return { page: pageContext(), questions };
  };

  window.__jobApplierWriteAnswers = async function writeAnswers(answers, options) {
    const opts = options || {};
    const entries = [];

    const byId = new Map();
    document
      .querySelectorAll('[data-jobapplier-qid]')
      .forEach((el) => byId.set(el.getAttribute('data-jobapplier-qid'), el));

    Object.keys(answers).forEach((id) => {
      const el = byId.get(id);
      if (!el) return;
      const current = (el.value || el.textContent || '').trim();
      if (current && !opts.overwrite) return;

      const value = String(answers[id]);
      if (el.isContentEditable) {
        el.textContent = value;
        fire(el, inputEvent(value));
        fire(el, new Event('change', { bubbles: true }));
      } else {
        typeInto(el, value);
      }
      flash(el, true);
      entries.push({ label: id, read: () => readBack(el), expected: readBack(el) });
    });

    const { stuck, reverted } = await verify(entries);
    return { filled: stuck.length, fields: stuck, reverted, skipped: [] };
  };

  window.__jobApplierFill = async function fill(profile, options) {
    const opts = options || {};
    const customFields = Array.isArray(profile.customFields) ? profile.customFields : [];
    const candidates = Array.from(
      document.querySelectorAll('input, textarea, select, [contenteditable="true"]')
    );
    const entries = [];
    const skipped = [];
    const seenKeys = new Set();

    for (const el of candidates) {
      if (el instanceof HTMLInputElement && !FILLABLE_TYPES.has(el.type)) continue;
      if (!isVisible(el)) continue;
      if (!opts.overwrite && el.value && el.value.trim()) continue;

      const signals = signalsFor(el);
      // A select full of dialing codes is a phone country picker whatever its
      // label claims, and some carry no label at all.
      const dial = el instanceof HTMLSelectElement && isDialCodeSelect(el);
      const match = dial
        ? { key: 'phoneCountry' }
        : signals.length
          ? matchKey(signals, customFields)
          : null;
      if (!match) continue;

      let value;
      if (match.key === '__custom__') value = match.value;
      else if (match.key === 'phoneCountry') value = dialCodeFor(profile);
      else value = profile[match.key];
      if (!value || !String(value).trim()) continue;

      // Some keys must not repeat down the page: a second education row is a
      // different school, not the same one again.
      const dedupeKey = match.key === '__custom__' ? `custom:${value}` : match.key;
      if (seenKeys.has(dedupeKey) && FILL_ONCE.has(match.key)) continue;

      let ok = true;
      if (el instanceof HTMLSelectElement) {
        ok = dial
          ? fillDialSelect(el, String(value), profile.country)
          : fillSelect(el, String(value));
      } else if (el.isContentEditable) {
        el.textContent = String(value);
        fire(el, inputEvent(String(value)));
        fire(el, new Event('change', { bubbles: true }));
      } else {
        // A country-code text box wants "+1", not "1".
        typeInto(el, match.key === 'phoneCountry' ? `+${value}` : String(value));
      }

      flash(el, ok);
      if (!ok) continue;

      seenKeys.add(dedupeKey);
      entries.push({
        label: match.key === '__custom__' ? `custom (${value})` : match.key,
        read: () => readBack(el),
        expected: readBack(el),
      });
    }

    fillChoiceGroups({ profile, customFields, opts, seenKeys, entries, skipped });

    const { stuck, reverted } = await verify(entries);
    return { filled: stuck.length, fields: stuck, reverted, skipped };
  };
})();
