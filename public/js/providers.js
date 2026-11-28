// public/js/providers.js — "Where to watch" helpers. Availability data comes from TMDB's watch-provider
// endpoint, which is provided by JustWatch and requires attribution wherever it is shown.
const COUNTRY_KEY = 'cinemind_country';

export const COUNTRIES = [
  ['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['NZ', 'New Zealand'], ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['NL', 'Netherlands'], ['SE', 'Sweden'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['JP', 'Japan'], ['KR', 'South Korea'],
  ['SG', 'Singapore'], ['AE', 'United Arab Emirates'], ['ZA', 'South Africa'], ['PK', 'Pakistan'],
  ['BD', 'Bangladesh'], ['LK', 'Sri Lanka'], ['NP', 'Nepal'],
];

export const ATTRIBUTION_HTML =
  'Streaming availability by <a href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer">JustWatch</a>';

const GROUPS = [['stream', 'Stream'], ['free', 'Free'], ['ads', 'Free with ads'], ['rent', 'Rent'], ['buy', 'Buy']];
const PER_GROUP = 5;

const TIMEZONE_COUNTRIES = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dhaka': 'BD', 'Asia/Karachi': 'PK',
  'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP', 'Europe/London': 'GB', 'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL',
  'Europe/Stockholm': 'SE', 'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Pacific/Auckland': 'NZ',
  'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX', 'Africa/Johannesburg': 'ZA', 'Asia/Dubai': 'AE',
};

const esc = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const isCountryCode = (value) => /^[A-Z]{2}$/.test(String(value));

// Best guess from the browser: a language region ("en-IN") first, then the time zone, else the US
export function detectCountry({ languages = [], timeZone = '' } = {}) {
  for (const lang of languages) {
    const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})(?:$|[-_])/.exec(String(lang));
    if (m) return m[1].toUpperCase();
  }
  return TIMEZONE_COUNTRIES[timeZone] || 'US';
}

// The saved country (storage is injected), otherwise the detected one
export function getCountry(storage, env) {
  try {
    const saved = storage.getItem(COUNTRY_KEY);
    if (isCountryCode(saved)) return saved;
  } catch { /* storage unavailable */ }
  return detectCountry(env);
}

export function saveCountry(storage, code) {
  if (!isCountryCode(code)) return;
  try {
    storage.setItem(COUNTRY_KEY, code);
  } catch { /* ignore */ }
}

export function countryOptionsHtml(selected) {
  const list = COUNTRIES.some(([code]) => code === selected) ? COUNTRIES : [[selected, `Other (${selected})`], ...COUNTRIES];
  return list.map(([code, name]) => `<option value="${esc(code)}" ${code === selected ? 'selected' : ''}>${esc(name)}</option>`).join('');
}

const safeLogo = (url) => (/^https:\/\/image\.tmdb\.org\//.test(url || '') ? esc(url) : '');
const safeLink = (url) => (/^https:\/\/(www\.)?(themoviedb\.org|justwatch\.com)\//.test(url || '') ? esc(url) : '');

// HTML for one title's availability, from GET /api/providers/:mediaType/:id
export function buildProviders(data) {
  if (!data || !data.available) {
    return `<span class="where__none">Not listed on streaming services in ${esc(data?.country || 'your country')}.</span>`;
  }
  const groups = GROUPS.filter(([key]) => Array.isArray(data[key]) && data[key].length).map(([key, label]) => {
    const list = data[key];
    const chips = list.slice(0, PER_GROUP).map((p) => {
      const logo = safeLogo(p.logo);
      return `<span class="where__chip">${logo ? `<img class="where__logo" src="${logo}" alt="" loading="lazy">` : ''}${esc(p.name)}</span>`;
    });
    if (list.length > PER_GROUP) chips.push(`<span class="where__more">+${list.length - PER_GROUP} more</span>`);
    return `<div class="where__group"><span class="where__label">${esc(label)}</span>${chips.join('')}</div>`;
  });
  const link = safeLink(data.link);
  return `${groups.join('')}${link ? `<a class="where__link" href="${link}" target="_blank" rel="noopener noreferrer">All options ↗</a>` : ''}`;
}

// Fetch availability (cached in memory with TTL and LRU eviction)
const PROVIDERS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PROVIDERS_CACHE_MAX_SIZE = 200;
const memo = new Map();

function memoGet(key) {
  const entry = memo.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memo.delete(key);
    return undefined;
  }
  // LRU: move to end
  memo.delete(key);
  memo.set(key, entry);
  return entry.data;
}

function memoSet(key, data) {
  if (memo.size >= PROVIDERS_CACHE_MAX_SIZE) {
    // Evict oldest (first entry)
    const oldestKey = memo.keys().next().value;
    memo.delete(oldestKey);
  }
  memo.set(key, { data, expiresAt: Date.now() + PROVIDERS_CACHE_TTL_MS });
}

export async function fetchProviders(mediaType, id, country, fetchFn = fetch) {
  const key = `providers:v1:${mediaType}:${id}:${country}`;
  const cached = memoGet(key);
  if (cached !== undefined) return cached;
  const res = await fetchFn(`/api/providers/${encodeURIComponent(mediaType)}/${encodeURIComponent(id)}?country=${encodeURIComponent(country)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load availability');
  memoSet(key, data);
  return data;
}
