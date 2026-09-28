/**
 * Field-matching tests for content.js. Run with: npm test
 * (requires `npm install` for the jsdom devDependency)
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contentScript = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

const PROFILE = {
  firstName: 'Nikhil',
  lastName: 'Polepalli',
  fullName: 'Nikhil Polepalli',
  email: 'me@example.com',
  phone: '555-111-2222',
  github: 'https://github.com/NSPOLE01',
  linkedin: 'https://linkedin.com/in/nikhil',
  portfolio: 'https://nikhil.dev',
  twitter: 'https://x.com/nikhil',
  address: '1 Market St',
  city: 'San Francisco',
  state: 'CA',
  zip: '94105',
  country: 'United States',
  heardAbout: 'LinkedIn',
  school: 'University of Texas at Austin',
  degree: "Bachelor's Degree",
  discipline: 'Computer Science',
  customFields: [{ pattern: 'authorized to work', value: 'Yes' }],
};

function run(html, options = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://jobs.example.com/apply',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  // jsdom has no layout: fake box sizes, treating display:none subtrees as hidden.
  window.Element.prototype.getBoundingClientRect = function rect() {
    const hidden = this.closest('[style*="display:none"], [style*="display: none"]');
    return hidden
      ? { width: 0, height: 0 }
      : { width: 200, height: 30, top: 0, left: 0, right: 200, bottom: 30, x: 0, y: 0 };
  };
  window.eval(contentScript);
  const result = window.__jobApplierFill(PROFILE, options);
  return { window, result };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

function valueOf(window, selector) {
  const el = window.document.querySelector(selector);
  return el ? el.value : '<missing>';
}

// --- Greenhouse / Lever / Ashby shaped markup -------------------------------
{
  const { window } = run(`<form>
    <label for="first_name">First Name *</label><input id="first_name" type="text">
    <label for="last_name">Last Name *</label><input id="last_name" type="text">
    <label for="email">Email *</label><input id="email" type="email">
    <label for="phone">Phone</label><input id="phone" type="tel">
    <li><label><span>LinkedIn URL</span><input name="linkedin" type="text"></label></li>
    <li><label><span>Github URL</span><input name="gh" type="text"></label></li>
    <li><label><span>Portfolio</span><input name="portfolio" type="text"></label></li>
    <div><div class="label">Website</div><input name="website" aria-label="Website" type="url"></div>
    <input name="tw" placeholder="https://twitter.com/username" type="text">
    <div><label for="q1">How did you hear about us?</label><input id="q1" type="text"></div>
    <div><label for="q2">Are you authorized to work in the US?</label><input id="q2" type="text"></div>
    <label for="country">Country</label>
    <select id="country"><option value="">Select</option><option value="US">United States</option></select>
    <label for="city">City</label><input id="city" type="text" value="Austin">
    <input name="password" type="password">
    <input name="csrf" type="hidden" value="x">
  </form>`);

  check('first name', valueOf(window, '#first_name'), 'Nikhil');
  check('last name (not shadowed by sibling label)', valueOf(window, '#last_name'), 'Polepalli');
  check('email', valueOf(window, '#email'), 'me@example.com');
  check('phone', valueOf(window, '#phone'), '555-111-2222');
  check('linkedin via wrapping label', valueOf(window, '[name=linkedin]'), PROFILE.linkedin);
  check('github before generic url rule', valueOf(window, '[name=gh]'), PROFILE.github);
  check('portfolio', valueOf(window, '[name=portfolio]'), PROFILE.portfolio);
  check('website via aria-label', valueOf(window, '[name=website]'), PROFILE.portfolio);
  check('twitter via placeholder', valueOf(window, '[name=tw]'), PROFILE.twitter);
  check('how did you hear', valueOf(window, '#q1'), 'LinkedIn');
  check('custom field pattern', valueOf(window, '#q2'), 'Yes');
  check('country select resolves to option value', valueOf(window, '#country'), 'US');
  check('prefilled field untouched', valueOf(window, '#city'), 'Austin');
  check('password untouched', valueOf(window, '[name=password]'), '');
  check('hidden input untouched', valueOf(window, '[name=csrf]'), 'x');
}

// --- Workday shaped markup + false-positive guards ---------------------------
{
  const { window } = run(`
    <nav><input name="q" type="search" placeholder="Search jobs"></nav>
    <form>
      <div data-automation-id="legalNameSection_firstName"><input name="wd_first" data-automation-id="legalNameSection_firstName" type="text"></div>
      <div><span>Name</span><input name="name" type="text"></div>
      <fieldset><legend>Address</legend>
        <div><label for="a1">Address Line 1</label><input id="a1" type="text"></div>
        <div><label for="s1">State/Province</label><input id="s1" type="text"></div>
        <div><label for="z1">Postal Code</label><input id="z1" type="text"></div>
      </fieldset>
      <div><label for="cw">Company Website</label><input id="cw" type="url"></div>
      <div><label for="re">Reference Email</label><input id="re" type="email"></div>
      <div><label for="ref">Referred by (employee name)</label><input id="ref" type="text"></div>
      <div style="display:none"><label for="hid">LinkedIn</label><input id="hid" type="text"></div>
    </form>`);

  check('workday data-automation-id', valueOf(window, '[name=wd_first]'), 'Nikhil');
  check('bare "Name" gets full name', valueOf(window, '[name=name]'), 'Nikhil Polepalli');
  check('address line 1', valueOf(window, '#a1'), '1 Market St');
  check('state/province', valueOf(window, '#s1'), 'CA');
  check('postal code', valueOf(window, '#z1'), '94105');
  check('company website excluded', valueOf(window, '#cw'), '');
  check('reference email excluded', valueOf(window, '#re'), '');
  check('referred-by not treated as a name', valueOf(window, '#ref'), '');
  check('hidden subtree skipped', valueOf(window, '#hid'), '');
  check('site search box skipped', valueOf(window, '[name=q]'), '');
}

// --- education section -------------------------------------------------------
{
  const { window } = run(`<form>
    <label for="sch">School</label><input id="sch" name="job_application[educations][][school_name]" type="text">
    <label for="deg">Degree</label>
    <select id="deg"><option value="">Select</option><option value="3">Bachelor's Degree</option><option value="4">Master's Degree</option></select>
    <label for="dis">Discipline</label><input id="dis" type="text">
    <div><label for="gpa">GPA</label><input id="gpa" type="text"></div>
    <div><label for="hs">High School Name</label><input id="hs" type="text"></div>
    <div><label for="su">University Website</label><input id="su" type="url"></div>
  </form>`);

  check('school (underscored name attribute)', valueOf(window, '#sch'), 'University of Texas at Austin');
  check('degree select', valueOf(window, '#deg'), '3');
  check('discipline', valueOf(window, '#dis'), 'Computer Science');
  check('gpa left alone', valueOf(window, '#gpa'), '');
  check('high school excluded', valueOf(window, '#hs'), '');
  check('university website not given portfolio', valueOf(window, '#su'), '');
}

{
  const { window } = run(`<form><label for="maj">Major / Field of Study</label><input id="maj" type="text"></form>`);
  check('major maps to discipline', valueOf(window, '#maj'), 'Computer Science');
}

{
  // Two education rows: the second is a different school, so leave it blank.
  const { window } = run(`<form>
    <div><label for="s1">School</label><input id="s1" type="text"></div>
    <div><label for="s2">School</label><input id="s2" type="text"></div>
  </form>`);
  check('first education row filled', valueOf(window, '#s1'), 'University of Texas at Austin');
  check('second education row left blank', valueOf(window, '#s2'), '');
}

// --- overwrite mode ----------------------------------------------------------
{
  const markup = `<form><label for="gh">GitHub</label><input id="gh" type="url" value="https://github.com/old"></form>`;
  const off = run(markup, { overwrite: false });
  check('overwrite off keeps existing value', valueOf(off.window, '#gh'), 'https://github.com/old');
  const on = run(markup, { overwrite: true });
  check('overwrite on replaces value', valueOf(on.window, '#gh'), PROFILE.github);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
