// Small shared helpers for the admin screens. Everything that comes from the API goes through esc().
export const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const num = (value: unknown, digits = 0) =>
  Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const minutes = (value: unknown) => `${num(value, Number(value) < 10 ? 1 : 0)} min`;

export function when(value: unknown, withTime = true) {
  if (!value) return '<span class="dim">—</span>';
  const d = new Date(String(value));
  const text = withTime
    ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<span title="${esc(d.toString())}">${esc(text)}</span>`;
}

export function ago(value: unknown) {
  if (!value) return '<span class="dim">Never</span>';
  const s = (Date.now() - new Date(String(value)).getTime()) / 1000;
  const text = s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
  return `<span title="${esc(new Date(String(value)).toLocaleString())}">${text}</span>`;
}

// Integer minor units (cents/paise) -> "$12.34", without float rounding.
export function money(value: unknown, currency: unknown = 'USD') {
  const n = BigInt(String(value || 0));
  const c = String(currency || 'USD').toUpperCase();
  const sym = c === 'USD' ? '$' : c === 'INR' ? '₹' : `${c} `;
  const neg = n < 0n ? '-' : '';
  const a = n < 0n ? -n : n;
  return `${neg}${sym}${(a / 100n).toLocaleString('en-IN')}.${String(a % 100n).padStart(2, '0')}`;
}

export const moneyList = (rows: any[], key: string) =>
  rows && rows.length ? rows.map((r) => money(r[key], r.currency)).join(' + ') : money(0);

export function planBadge(plan: unknown) {
  const p = String(plan || 'free').toLowerCase();
  return `<span class="pill plan-${esc(p)}">${esc(p.charAt(0).toUpperCase() + p.slice(1))}</span>`;
}

export const yesNo = (ok: boolean, yes = 'Verified', no = 'Not verified') =>
  `<span class="pill ${ok ? 'good' : 'warn'}">${ok ? yes : no}</span>`;

// Minutes used this month against the plan allowance.
export function usageBar(used: number, limit: number | undefined) {
  if (!limit) return `<div class="usage"><strong>${minutes(used)}</strong></div>`;
  const pct = Math.min(100, (used / limit) * 100);
  const tone = pct >= 100 ? 'over' : pct >= 80 ? 'high' : '';
  return `<div class="usage"><div class="usage-text"><strong>${minutes(used)}</strong><span>of ${num(limit)}</span></div><div class="bar ${tone}"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
}

export function kpis(items: [label: string, value: string, hint?: string, href?: string][]) {
  return `<div class="kpis">${items
    .map(([l, v, h, href]) => {
      const inner = `<span class="kpi-label">${esc(l)}</span><strong class="kpi-value">${v}</strong>${h ? `<span class="kpi-hint">${h}</span>` : ''}`;
      return href ? `<a class="kpi kpi-link" href="${esc(href)}">${inner}<span class="kpi-go">See who →</span></a>` : `<div class="kpi">${inner}</div>`;
    })
    .join('')}</div>`;
}

// headers: [label, alignRight?]; cells are already-escaped HTML.
export function dataTable(headers: (string | [string, 'num'])[], rows: string[][], empty = 'No records yet.', rowAttrs: string[] = []) {
  const head = headers.map((h) => (Array.isArray(h) ? `<th class="num">${esc(h[0])}</th>` : `<th>${esc(h)}</th>`)).join('');
  const isNum = headers.map((h) => Array.isArray(h));
  const body = rows.length
    ? rows.map((r, i) => `<tr ${rowAttrs[i] || ''}>${r.map((c, j) => `<td${isNum[j] ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="empty-row">${esc(empty)}</td></tr>`;
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function pageHeader(title: string, subtitle: string, actions = '') {
  return `<header class="page-head"><div><h1>${esc(title)}</h1><p>${subtitle}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

// Short browser/OS name from a user-agent string.
export function device(ua: unknown) {
  const s = String(ua || '');
  if (!s) return '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Other browser';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
