/**
 * Pencarian web untuk grounding balasan chat.
 *
 * Exa hanya dipanggil saat user mengaktifkan pencarian web untuk pesan tersebut.
 * API key tetap berada di backend; hasil dibatasi dan dinormalisasi sebelum
 * disisipkan ke system prompt atau dikirim kembali sebagai sumber.
 */

const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESULTS = 5;
const MAX_HIGHLIGHT_CHARS = 1800;

const isConfigured = () => Boolean(String(process.env.EXA_API_KEY || '').trim());

const cleanText = (value, maxLength = 300) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeSource = (result) => {
  if (!result || typeof result.url !== 'string') return null;

  let url;
  try {
    url = new URL(result.url);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol)) return null;

  const highlights = Array.isArray(result.highlights)
    ? result.highlights
        .filter((highlight) => typeof highlight === 'string')
        .map((highlight) => cleanText(highlight, MAX_HIGHLIGHT_CHARS))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  return {
    title: cleanText(result.title, 300) || url.hostname,
    url: url.href,
    publishedDate: cleanText(result.publishedDate, 40) || null,
    highlights
  };
};

const searchWeb = async (query) => {
  const apiKey = String(process.env.EXA_API_KEY || '').trim().split(/\s+/)[0];
  if (!apiKey) {
    const error = new Error('Web search is not configured. Set EXA_API_KEY in the backend environment.');
    error.code = 'WEB_SEARCH_NOT_CONFIGURED';
    throw error;
  }

  let response;
  try {
    response = await fetch(EXA_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: String(query).slice(0, 1000),
        type: 'auto',
        numResults: MAX_RESULTS,
        contents: { highlights: true }
      }),
      signal: AbortSignal.timeout(Number(process.env.WEB_SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)
    });
  } catch {
    const error = new Error('Exa web search could not be reached.');
    error.code = 'WEB_SEARCH_UNAVAILABLE';
    throw error;
  }

  if (!response.ok) {
    // Jangan teruskan body upstream: bisa memuat detail yang tidak perlu
    // (atau data sensitif dari provider) ke pesan yang tampil di browser.
    const error = new Error(`Exa web search returned HTTP ${response.status}.`);
    error.code = 'WEB_SEARCH_UNAVAILABLE';
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error('Exa web search returned an invalid response.');
    error.code = 'WEB_SEARCH_UNAVAILABLE';
    throw error;
  }

  const sources = (Array.isArray(payload.results) ? payload.results : [])
    .map(normalizeSource)
    .filter((source) => source && source.highlights.length)
    .slice(0, MAX_RESULTS);

  if (!sources.length) {
    const error = new Error('Exa web search found no usable sources for this question.');
    error.code = 'WEB_SEARCH_NO_RESULTS';
    throw error;
  }

  return { searchedAt: new Date().toISOString(), sources };
};

module.exports = { searchWeb, isConfigured, normalizeSource, MAX_RESULTS };
