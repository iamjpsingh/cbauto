// Compact page snapshot: only visible, interactive elements, one short line each.
// This is what keeps token usage tiny compared to sending full DOM / screenshots.

const INTERACTIVE =
  'a[href],button,input:not([type=hidden]),select,textarea,summary,' +
  '[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],' +
  '[role=option],[role=switch],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],[onclick]';

// Runs inside the page. Tags each element with data-cb=<index> so we can act on it later.
function collect(selector) {
  const out = [];
  const clip = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  document.querySelectorAll('[data-cb]').forEach((el) => el.removeAttribute('data-cb'));
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
    if (el.disabled) continue;
    const i = out.length;
    el.setAttribute('data-cb', String(i));
    const labelEl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const wrapLabel = el.closest('label');
    out.push({
      i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      text: clip(el.innerText || el.value || '', 60),
      label: clip(
        el.getAttribute('aria-label') ||
          (labelEl && labelEl.innerText) ||
          (wrapLabel && wrapLabel !== el && wrapLabel.innerText) ||
          el.getAttribute('title') ||
          el.getAttribute('alt') ||
          '',
        60
      ),
      placeholder: clip(el.getAttribute('placeholder'), 40),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      testid: el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
      href: el.tagName === 'A' ? clip(el.getAttribute('href'), 40) : '',
    });
  }
  return out;
}

export async function snapshot(page) {
  return page.evaluate(collect, INTERACTIVE);
}

// One compact line per element, e.g.:  7 input[email] "Email" ph="you@x.com" name=email
export function formatElement(e) {
  let s = `${e.i} ${e.tag}`;
  if (e.type && e.tag === 'input') s += `[${e.type}]`;
  if (e.role) s += ` role=${e.role}`;
  if (e.text) s += ` "${e.text}"`;
  if (e.label && e.label !== e.text) s += ` label="${e.label}"`;
  if (e.placeholder) s += ` ph="${e.placeholder}"`;
  if (e.name) s += ` name=${e.name}`;
  if (e.href) s += ` href=${e.href}`;
  return s;
}

const STOP = new Set(['the', 'a', 'an', 'on', 'in', 'of', 'to', 'for', 'and', 'or', 'with', 'field', 'box', 'input', 'button', 'link', 'click', 'enter', 'type', 'into', 'at', 'my']);
const words = (s) => (s || '').toLowerCase().match(/[a-z0-9]+/g) || [];

// Zero-token heuristic: score how well an element matches a plain-English description.
export function score(e, description) {
  const desc = description.toLowerCase();
  const want = words(desc).filter((w) => !STOP.has(w));
  const hay = [e.text, e.label, e.placeholder, e.name, e.id, e.testid, e.type].join(' ').toLowerCase();
  const hayWords = new Set(words(hay));
  let sc = 0;
  for (const w of want) if (hayWords.has(w)) sc += 2;
  for (const f of [e.text, e.label, e.placeholder]) {
    if (f && f.length > 1 && desc.includes(f.toLowerCase())) sc += 4;
  }
  const isButton = e.tag === 'button' || e.role === 'button' || ['submit', 'button'].includes(e.type);
  const isField = ['input', 'textarea', 'select'].includes(e.tag) && !isButton;
  if (/\bbutton\b/.test(desc) && isButton) sc += 1;
  if (/\blink\b/.test(desc) && e.tag === 'a') sc += 1;
  if (/\b(field|input|box)\b/.test(desc) && isField) sc += 1;
  if (/\bcheckbox\b/.test(desc) && (e.type === 'checkbox' || e.role === 'checkbox')) sc += 2;
  if (/\b(dropdown|select)\b/.test(desc) && e.tag === 'select') sc += 2;
  return sc;
}
