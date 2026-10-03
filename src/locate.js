import fs from 'node:fs';
import path from 'node:path';
import { snapshot, formatElement, score } from './snapshot.js';
import { aiAvailable, pickElement } from './ai.js';

const CACHE_FILE = process.env.CBAUTO_CACHE || '.cbauto/selectors.json';
let cache;
const loadCache = () => {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
  return cache;
};
const saveCache = () => {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
};

const MAX_LINES = 40; // cap on what we ever send to the model

// Build a stable selector for the element tagged data-cb=<i>, verified to be unique.
async function stableSelector(page, e) {
  const q = (v) => JSON.stringify(v);
  const cands = [];
  if (e.testid) cands.push(`[data-testid=${q(e.testid)}]`, `[data-test=${q(e.testid)}]`);
  if (e.id && !/\d{3,}|[:]/.test(e.id)) cands.push(`#${e.id.replace(/([^\w-])/g, '\\$1')}`);
  if (e.name) cands.push(`${e.tag}[name=${q(e.name)}]`);
  if (e.label) cands.push(`${e.tag}[aria-label=${q(e.label)}]`);
  if (e.placeholder) cands.push(`${e.tag}[placeholder=${q(e.placeholder)}]`);
  if (e.text && e.text.length < 40) cands.push(`${e.tag}:text-is(${q(e.text)})`);
  for (const sel of cands) {
    try {
      const loc = page.locator(sel);
      if ((await loc.count()) === 1 && (await loc.getAttribute('data-cb')) === String(e.i)) return sel;
    } catch { /* invalid selector for this engine, try next */ }
  }
  return null; // no stable selector; still usable this run via data-cb
}

/**
 * Resolve a plain-English description to a Playwright locator.
 * Order: cache (free) -> heuristic (free) -> Haiku (tiny prompt). Result is cached.
 */
export async function find(page, description, action = 'interact', log = () => {}) {
  const key = `${new URL(page.url()).origin}${new URL(page.url()).pathname}|${description}`;
  const c = loadCache();
  if (c[key]) {
    const loc = page.locator(c[key]);
    if ((await loc.count().catch(() => 0)) > 0) return loc.first();
    log(`  cache miss for "${description}", re-resolving`);
  }

  const els = await snapshot(page);
  if (!els.length) throw new Error(`find("${description}"): no interactive elements on page`);
  const ranked = els.map((e) => ({ e, s: score(e, description) })).sort((a, b) => b.s - a.s);
  const [top, second] = ranked;

  let chosen = null;
  if (top.s >= 4 && top.s >= 2 * (second?.s || 0)) {
    chosen = top.e;
    log(`  matched "${description}" by text (0 tokens)`);
  } else if (aiAvailable()) {
    const pool = ranked.slice(0, MAX_LINES).map((r) => r.e).sort((a, b) => a.i - b.i);
    const idx = await pickElement(action, description, pool.map(formatElement));
    chosen = els.find((e) => e.i === idx) || null;
    log(`  matched "${description}" via AI -> #${idx}`);
  } else if (top.s > 0) {
    chosen = top.e;
    log(`  matched "${description}" by best guess (no API key set)`);
  }
  if (!chosen) throw new Error(`find("${description}"): no matching element`);

  const sel = await stableSelector(page, chosen);
  if (sel) { c[key] = sel; saveCache(); }
  return page.locator(sel || `[data-cb="${chosen.i}"]`).first();
}
