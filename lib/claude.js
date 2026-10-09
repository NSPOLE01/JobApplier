/**
 * Claude request building and response parsing.
 *
 * Pure functions, no network: background.js does the fetch so the API key
 * never reaches a page or a content script. Called through raw HTTP rather
 * than the npm SDK because an unpacked MV3 extension has no bundler.
 */

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 — best writing ($4/$20 per Mtok)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 — faster, cheaper ($2/$10)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — cheapest ($1/$5)' },
];

export const DEFAULT_MODEL = 'claude-opus-5-5';

const SYSTEM_PROMPT = [
  'You are helping one job applicant answer short free-text questions on an application form.',
  'Write as them, in first person, in a plain voice that sounds like a real person typing.',
  '',
  'Rules:',
  '- Exactly two sentences per answer. Never three.',
  '- Use only what the applicant background and the job posting actually say. Never invent an',
  '  employer, a date, a metric, a project, or a personal anecdote.',
  '- Be specific to this company and role. Name what they actually do, in ordinary words.',
  '- Banned, because they read as filler: excited, thrilled, passionate, delighted, honored,',
  '  align, leverage, synergy, resonate, deeply, truly, incredibly, perfect fit, dream job,',
  '  "I am writing to", "As someone who".',
  '- No em dashes. No exclamation marks. No rhetorical questions. No opening flattery.',
  '- Contractions are good. Vary the sentence lengths. Short words beat long ones.',
  '- If the background does not support a specific claim, write the honest general version',
  '  instead of inventing a specific one.',
].join('\n');

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['id', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
};

function truncate(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

/** Everything we know about the applicant, as plain lines. */
export function describeApplicant(profile) {
  const lines = [];
  const add = (label, value) => {
    if (value && String(value).trim()) lines.push(`${label}: ${String(value).trim()}`);
  };

  add('Name', profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' '));
  add('Current title', profile.currentTitle);
  add('Current company', profile.currentCompany);
  add('School', profile.school);
  add('Degree', [profile.degree, profile.discipline].filter(Boolean).join(', '));
  add('GitHub', profile.github);
  add('Portfolio', profile.portfolio);
  add('Background notes', profile.background);

  return lines.length ? lines.join('\n') : 'No background provided.';
}

export function buildUserMessage(page, questions, profile) {
  const parts = [
    `Company: ${page.company || 'unknown'}`,
    `Role: ${page.role || 'unknown'}`,
  ];
  if (page.description) {
    parts.push('', 'Job posting (excerpt):', truncate(page.description, 6000));
  }
  parts.push('', 'Applicant:', describeApplicant(profile));
  parts.push(
    '',
    'Answer each question below. Return one entry per question, keyed by its id.',
    ''
  );
  questions.forEach((q) => {
    const limit = q.maxLength ? ` (max ${q.maxLength} characters)` : '';
    parts.push(`[${q.id}]${limit} ${truncate(q.question, 600)}`);
  });

  return parts.join('\n');
}

export function buildRequestBody(page, questions, profile, model) {
  return {
    model: model || DEFAULT_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    // Opus 5.5 always thinks; low effort keeps a two-sentence answer quick.
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
    },
    fallbacks: 'default',
    messages: [{ role: 'user', content: buildUserMessage(page, questions, profile) }],
  };
}

/** The structured-output contract puts valid JSON in the first text block. */
export function parseAnswers(response) {
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer these questions.');
  }

  const text = (response.content || []).find((block) => block.type === 'text');
  if (!text) throw new Error('Claude returned no text.');

  let parsed;
  try {
    parsed = JSON.parse(text.text);
  } catch (_) {
    throw new Error('Could not read Claude’s response.');
  }

  const answers = Array.isArray(parsed.answers) ? parsed.answers : [];
  const byId = {};
  answers.forEach((entry) => {
    if (entry && entry.id && entry.answer) byId[entry.id] = String(entry.answer).trim();
  });
  return byId;
}

export function describeApiError(status, payload) {
  const detail = payload && payload.error && payload.error.message;
  if (status === 401) return 'That API key was rejected. Check it in the popup.';
  if (status === 400) return `Claude rejected the request: ${detail || 'bad request'}`;
  if (status === 429) return 'Rate limited by the API. Wait a moment and try again.';
  if (status === 529) return 'The API is overloaded right now. Try again shortly.';
  return `Claude API error ${status}: ${detail || 'unknown'}`;
}
