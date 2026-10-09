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
  pronouns: 'they/them',
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
  currentCompany: 'Acme Corp',
  currentTitle: 'Engineer',
  gender: 'Male',
  hispanicLatino: 'No',
  race: 'Asian',
  veteranStatus: 'I am not a protected veteran',
  school: 'University of Texas at Austin',
  degree: "Bachelor's Degree",
  discipline: 'Computer Science',
  customFields: [{ pattern: 'authorized to work', value: 'Yes' }],
};

async function run(html, options = {}, profileOverride = {}) {
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
  const result = await window.__jobApplierFill({ ...PROFILE, ...profileOverride }, options);
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
  const { window } = await run(`<form>
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
  const { window } = await run(`
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
  const { window } = await run(`<form>
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
  const { window } = await run(`<form><label for="maj">Major / Field of Study</label><input id="maj" type="text"></form>`);
  check('major maps to discipline', valueOf(window, '#maj'), 'Computer Science');
}

{
  // Two education rows: the second is a different school, so leave it blank.
  const { window } = await run(`<form>
    <div><label for="s1">School</label><input id="s1" type="text"></div>
    <div><label for="s2">School</label><input id="s2" type="text"></div>
  </form>`);
  check('first education row filled', valueOf(window, '#s1'), 'University of Texas at Austin');
  check('second education row left blank', valueOf(window, '#s2'), '');
}

// --- work fields and decorated labels ----------------------------------------
{
  // One label per fixture: work keys fill once per page, so sharing a form
  // would hide misses behind the dedupe.
  const cases = [
    ['Company name', 'Acme Corp'],
    ['Company Name *', 'Acme Corp'],
    ['Company', 'Acme Corp'],
    ['Company *', 'Acme Corp'],
    ['Employer Name', 'Acme Corp'],
    ['Most Recent Employer', 'Acme Corp'],
    ['Organization', 'Acme Corp'],
    ['Name *', 'Nikhil Polepalli'],
    ['Title (required)', 'Engineer'],
    ['Position Title', 'Engineer'],
    ['Role', 'Engineer'],
    ['Company Website', ''],
    ['Company Email', ''],
    ['Company Size', ''],
  ];

  for (const [label, expected] of cases) {
    const { window } = await run(`<form><label for="f">${label}</label><input id="f" type="text"></form>`);
    check(`label "${label}"`, valueOf(window, '#f'), expected);
  }
}

{
  // Two employer rows: the second is a different job.
  const { window } = await run(`<form>
    <div><label for="e1">Company Name</label><input id="e1" type="text"></div>
    <div><label for="e2">Company Name</label><input id="e2" type="text"></div>
  </form>`);
  check('first employer row filled', valueOf(window, '#e1'), 'Acme Corp');
  check('second employer row left blank', valueOf(window, '#e2'), '');
}

// --- voluntary self-identification -------------------------------------------
{
  const { window } = await run(`<form>
    <label for="g">Gender</label>
    <select id="g" name="job_application[gender]">
      <option value="">Select...</option><option value="1">Male</option><option value="2">Female</option>
      <option value="3">Decline To Self Identify</option>
    </select>
    <label for="h">Are you Hispanic/Latino?</label>
    <select id="h" name="job_application[hispanic_ethnicity]">
      <option value="">Select...</option><option value="1">Yes</option><option value="2">No</option>
    </select>
    <label for="v">Veteran Status</label>
    <select id="v">
      <option value="">Select...</option>
      <option value="1">I identify as one or more of the classifications of a protected veteran</option>
      <option value="2">No, I am not a protected veteran</option>
      <option value="3">I don't wish to answer</option>
    </select>
    <label for="r">Race / Ethnicity</label>
    <select id="r"><option value="">Select...</option><option value="1">Asian</option><option value="2">White</option></select>
    <div><label for="p">Gender pronouns</label><input id="p" type="text"></div>
  </form>`);

  check('gender select', valueOf(window, '#g'), '1');
  check('hispanic/latino select', valueOf(window, '#h'), '2');
  check('veteran status matches longer option wording', valueOf(window, '#v'), '2');
  check('race gets the race answer, not the hispanic one', valueOf(window, '#r'), '1');
  check('"Gender pronouns" stays pronouns', valueOf(window, '#p'), 'they/them');
}

{
  // ATS race options usually carry a parenthetical suffix.
  const { window } = await run(`<form>
    <div><label for="r1">Race / Ethnicity</label>
      <select id="r1"><option value="">Select...</option>
        <option value="a">Asian (Not Hispanic or Latino)</option>
        <option value="w">White (Not Hispanic or Latino)</option>
      </select></div>
  </form>`);
  check('race matches option with parenthetical suffix', valueOf(window, '#r1'), 'a');
}

{
  const { window } = await run(`<form>
    <div><label for="r2">Please select your race</label>
      <select id="r2"><option value="">Select...</option>
        <option value="t">Two or more races (Not Hispanic or Latino)</option>
        <option value="b">Black or African American</option>
      </select></div>
  </form>`, {}, { race: 'Two or More Races' });
  check('multi-word race value matches longer option', valueOf(window, '#r2'), 't');
}

{
  // Hispanic question must keep answering itself, not fall through to race.
  const { window } = await run(`<form>
    <div><label for="h2">Hispanic or Latino ethnicity?</label>
      <select id="h2"><option value="">Select...</option><option value="y">Yes</option><option value="n">No</option></select></div>
  </form>`);
  check('hispanic label with "ethnicity" stays hispanic', valueOf(window, '#h2'), 'n');
}

{
  // Substring matching must not turn "Male" into "Female".
  const { window } = await run(`<form><label for="g">Gender</label>
    <select id="g"><option value="">Select...</option><option value="f">Female</option></select></form>`);
  check('no false substring match on gender', valueOf(window, '#g'), '');
}

{
  // Decline wording differs per ATS; match any decline-shaped option.
  const { window } = await run(`<form><label for="v">Veteran Status</label>
    <select id="v"><option value="">Select...</option><option value="9">I don't wish to answer</option></select></form>`,
    {}, { veteranStatus: 'Decline to self identify' });
  check('decline synonym matches', valueOf(window, '#v'), '9');
}

// --- how the value is written ------------------------------------------------
{
  const { window } = await run(`<form><label for="gh">GitHub</label><input id="gh" type="url"></form>`);
  const el = window.document.querySelector('#gh');
  check('value written', el.value, PROFILE.github);
}

{
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(`<!doctype html><body><form><label for="gh">GitHub</label><input id="gh" type="url"></form>`,
    { url: 'https://jobs.example.com/apply', runScripts: 'outside-only' });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 30 });
  window.eval(contentScript);
  const seen = [];
  const el = window.document.querySelector('#gh');
  ['focusin', 'input', 'change', 'focusout'].forEach((type) =>
    el.addEventListener(type, () => seen.push(type))
  );
  await window.__jobApplierFill(PROFILE, {});
  check('fires focusin, input, change, focusout', seen.join(','), 'focusin,input,change,focusout');
}

{
  // A controlled component that rejects the write: report it, don't claim success.
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(`<!doctype html><body><form><label for="gh">GitHub</label><input id="gh" type="url"></form>`,
    { url: 'https://jobs.example.com/apply', runScripts: 'outside-only' });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 30 });
  window.eval(contentScript);
  const el = window.document.querySelector('#gh');
  el.addEventListener('input', () => {
    setTimeout(() => {
      el.value = '';
    }, 0);
  });
  const result = await window.__jobApplierFill(PROFILE, {});
  check('reverted field is reported', JSON.stringify(result.reverted), '["github"]');
  check('reverted field is not counted as filled', result.filled, 0);
}

// --- phone country code ------------------------------------------------------
{
  // The common shape: a "Country" dropdown beside the phone box whose options
  // are dialing codes. +1 is the answer there, not "United States".
  const { window } = await run(`<form>
    <label for="ph">Phone</label>
    <div>
      <label for="cc">Country</label>
      <select id="cc"><option value="">Select...</option>
        <option value="ca">Canada +1</option>
        <option value="us">United States +1</option>
        <option value="gb">United Kingdom +44</option>
      </select>
      <input id="ph" type="tel">
    </div>
  </form>`);
  check('dial select beside phone gets the code', valueOf(window, '#cc'), 'us');
  check('phone itself still filled', valueOf(window, '#ph'), '555-111-2222');
}

{
  const { window } = await run(`<form><label for="cc">Country</label>
    <select id="cc"><option value="">Select</option><option value="1">+1</option><option value="44">+44</option></select>
    <label for="ac">Country</label>
    <select id="ac"><option value="">Select</option><option value="US">United States</option><option value="CA">Canada</option></select>
  </form>`);
  check('bare dialing codes match', valueOf(window, '#cc'), '1');
  check('address country select still gets the country name', valueOf(window, '#ac'), 'US');
}

{
  // No label at all, which is common for these pickers.
  const { window } = await run(`<form><select id="cc">
    <option value="">Select</option><option value="us">US (+1)</option><option value="de">Germany (+49)</option>
  </select></form>`);
  check('unlabeled dial select still filled', valueOf(window, '#cc'), 'us');
}

{
  const { window } = await run(`<form><label for="cc">Phone country code</label><input id="cc" type="text"></form>`);
  check('country code text box gets +1', valueOf(window, '#cc'), '+1');
}

{
  // "Phone country code" must not receive the phone number itself.
  const { window } = await run(`<form><label for="cc">Phone Country Code</label><input id="cc" type="text"></form>`);
  check('phone rule does not claim the code box', valueOf(window, '#cc'), '+1');
}

{
  const { window } = await run(`<form><label for="cc">Country</label>
    <select id="cc"><option value="">Select</option><option value="us">United States +1</option><option value="gb">United Kingdom +44</option></select></form>`,
    {}, { country: '', phone: '+44 20 7123 4567' });
  check('code derived from an international phone number', valueOf(window, '#cc'), 'gb');
}

{
  const { window } = await run(`<form><label for="cc">Country</label>
    <select id="cc"><option value="">Select</option><option value="us">United States +1</option><option value="in">India +91</option></select></form>`,
    {}, { phoneCountryCode: '+91' });
  check('explicit code setting wins', valueOf(window, '#cc'), 'in');
}

// --- choice questions as radios and buttons ----------------------------------
{
  // Greenhouse shape: fieldset + legend + radio inputs.
  const { window } = await run(`<form>
    <fieldset>
      <legend>Gender</legend>
      <label><input type="radio" name="gender" value="m"> Male</label>
      <label><input type="radio" name="gender" value="f"> Female</label>
      <label><input type="radio" name="gender" value="d"> Decline To Self Identify</label>
    </fieldset>
    <fieldset>
      <legend>Are you Hispanic/Latino?</legend>
      <label><input type="radio" name="hisp" value="y"> Yes</label>
      <label><input type="radio" name="hisp" value="n"> No</label>
    </fieldset>
  </form>`);
  check('radio gender answered', valueOf(window, 'input[name=gender]:checked'), 'm');
  check('radio hispanic answered', valueOf(window, 'input[name=hisp]:checked'), 'n');
}

{
  // Long EEO veteran wording, as radios.
  const { window } = await run(`<form><fieldset>
    <legend>Veteran Status</legend>
    <label><input type="radio" name="vet" value="1"> I identify as one or more of the classifications of a protected veteran</label>
    <label><input type="radio" name="vet" value="2"> No, I am not a protected veteran</label>
    <label><input type="radio" name="vet" value="3"> I don't wish to answer</label>
  </fieldset></form>`);
  check('radio veteran status answered', valueOf(window, 'input[name=vet]:checked'), '2');
}

{
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(`<!doctype html><body><form>
    <div class="question"><div class="title">Race</div>
      <div role="radiogroup">
        <div role="radio" aria-checked="false">Asian</div>
        <div role="radio" aria-checked="false">White</div>
      </div></div></form>`, { url: 'https://jobs.example.com/apply', runScripts: 'outside-only' });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 30 });
  window.eval(contentScript);
  const clicked = [];
  window.document.querySelectorAll('[role=radio]').forEach((el) =>
    el.addEventListener('click', () => clicked.push(el.textContent))
  );
  await window.__jobApplierFill(PROFILE, {});
  check('aria radiogroup: clicks the matching option', clicked.join(','), 'Asian');
}

{
  // Button-row shape, plus a submit button that must never be clicked.
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(`<!doctype html><body><form>
    <p>Veteran Status</p>
    <div>
      <button type="button">I am not a protected veteran</button>
      <button type="button">I identify as a protected veteran</button>
      <button type="button">Decline</button>
    </div>
    <button type="submit">Submit application</button>
  </form>`, { url: 'https://jobs.example.com/apply', runScripts: 'outside-only' });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 30 });
  window.eval(contentScript);
  const clicked = [];
  window.document.querySelectorAll('button').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      clicked.push(el.textContent);
    })
  );
  await window.__jobApplierFill(PROFILE, {});
  check('button group: clicks the matching option only', clicked.join(','), 'I am not a protected veteran');
}

{
  // An unrelated radio question must be left alone.
  const { window } = await run(`<form><fieldset>
    <legend>Are you willing to relocate?</legend>
    <label><input type="radio" name="rel" value="y"> Yes</label>
    <label><input type="radio" name="rel" value="n"> No</label>
  </fieldset></form>`);
  check('unrelated radio question untouched', valueOf(window, 'input[name=rel]:checked'), '<missing>');
}

{
  // Custom fields may answer radios, since you supplied the exact wording.
  const { window } = await run(`<form><fieldset>
    <legend>Are you authorized to work in the US?</legend>
    <label><input type="radio" name="auth" value="y"> Yes</label>
    <label><input type="radio" name="auth" value="n"> No</label>
  </fieldset></form>`);
  check('custom field answers a radio question', valueOf(window, 'input[name=auth]:checked'), 'y');
}

{
  // Already answered: leave it unless overwrite is on.
  const markup = `<form><fieldset><legend>Gender</legend>
    <label><input type="radio" name="g" value="m"> Male</label>
    <label><input type="radio" name="g" value="f" checked> Female</label>
  </fieldset></form>`;
  const off = await run(markup, { overwrite: false });
  check('answered question kept', valueOf(off.window, 'input[name=g]:checked'), 'f');
  const on = await run(markup, { overwrite: true });
  check('answered question replaced with overwrite', valueOf(on.window, 'input[name=g]:checked'), 'm');
}

{
  // Decline wording differs; match any decline-shaped option.
  const { window } = await run(`<form><fieldset><legend>Gender</legend>
    <label><input type="radio" name="g" value="m"> Male</label>
    <label><input type="radio" name="g" value="x"> I don't wish to answer</label>
  </fieldset></form>`, {}, { gender: 'Decline to self identify' });
  check('radio decline synonym', valueOf(window, 'input[name=g]:checked'), 'x');
}

// --- overwrite mode ----------------------------------------------------------
{
  const markup = `<form><label for="gh">GitHub</label><input id="gh" type="url" value="https://github.com/old"></form>`;
  const off = await run(markup, { overwrite: false });
  check('overwrite off keeps existing value', valueOf(off.window, '#gh'), 'https://github.com/old');
  const on = await run(markup, { overwrite: true });
  check('overwrite on replaces value', valueOf(on.window, '#gh'), PROFILE.github);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
