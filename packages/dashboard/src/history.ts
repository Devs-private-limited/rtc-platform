import { adminFetch } from './api';
import { dataTable, esc, pageHeader, when } from './ui';

// One readable sentence per admin change.
export function describeChange(e: any) {
  const d = e.detail || {};
  const mail = d.customerEmail === 'sent' ? ' <span class="pill good">customer emailed</span>' : d.customerEmail === 'failed' ? ' <span class="pill bad">email failed</span>' : '';
  return describe(e, d) + mail;
}
function describe(e: any, d: any) {
  switch (e.action) {
    case 'plan.change': return `Changed plan of <strong>${esc(d.email)}</strong> from ${esc(d.from)} to <strong>${esc(d.to)}</strong>. Reason: ${esc(d.reason)}`;
    case 'minutes.add': return `Gave <strong>${esc(Number(d.minutes).toLocaleString('en-IN'))} extra minutes</strong> to ${esc(d.email)} for ${esc(d.month)}. Reason: ${esc(d.note)}`;
    case 'minutes.remove': return `Removed ${esc(Number(d.minutes).toLocaleString('en-IN'))} extra minutes from ${esc(d.email)} (${esc(d.month)})`;
    case 'team.set': return `Gave <strong>${esc(e.target)}</strong> ${d.role === 'viewer' ? 'view-only' : 'admin'} access`;
    case 'team.remove': return `Removed admin access for <strong>${esc(e.target)}</strong>`;
    case 'summary.send': return `Sent the weekly summary email (${esc(d.result)})`;
    case 'account.block': return `<strong>Blocked</strong> ${esc(d.email)}. Reason: ${esc(d.reason)}`;
    case 'account.unblock': return `Unblocked ${esc(d.email)}. Reason: ${esc(d.reason)}`;
    case 'account.delete': return `<strong>Deleted</strong> the account ${esc(d.email)}. Reason: ${esc(d.reason)}`;
    default: return esc(e.action);
  }
}

const KINDS: [string, string][] = [['all', 'All changes'], ['plan', 'Plan changes'], ['minutes', 'Extra minutes'], ['account', 'Block / unblock / delete'], ['team', 'Admin team'], ['summary', 'Summary emails']];
const state = { q: '', kind: 'all', page: 1 };

export async function renderHistoryPage(view: HTMLElement) {
  view.innerHTML = pageHeader('Change history', 'Every change made in this admin panel: who did it, what, and when. Nothing here can be edited or deleted.') +
    `<section class="panel">
      <form id="hist-filter" class="toolbar">
        <input name="q" type="search" maxlength="200" placeholder="Search admin, customer email or reason" value="${esc(state.q)}" aria-label="Search">
        <label>Type<select name="kind">${KINDS.map(([v, l]) => `<option value="${v}"${state.kind === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <button type="submit">Search</button>
        ${state.q || state.kind !== 'all' ? '<button type="button" class="secondary" id="hist-clear">Clear</button>' : ''}
      </form>
      <p id="hist-status" class="note" role="status">Loading…</p>
      <div id="hist-table"></div>
      <div class="pager"><button class="secondary" id="hist-prev">← Previous</button><span id="hist-page"></span><button class="secondary" id="hist-next">Next →</button></div>
    </section>`;
  const form = view.querySelector<HTMLFormElement>('#hist-filter')!;
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    Object.assign(state, { q: String(f.get('q') || '').trim(), kind: String(f.get('kind') || 'all'), page: 1 });
    void renderHistoryPage(view);
  };
  const clear = view.querySelector<HTMLButtonElement>('#hist-clear');
  if (clear) clear.onclick = () => { Object.assign(state, { q: '', kind: 'all', page: 1 }); void renderHistoryPage(view); };
  const prev = view.querySelector<HTMLButtonElement>('#hist-prev')!, next = view.querySelector<HTMLButtonElement>('#hist-next')!;
  prev.onclick = () => { state.page--; void renderHistoryPage(view); };
  next.onclick = () => { state.page++; void renderHistoryPage(view); };
  prev.disabled = next.disabled = true;
  const status = view.querySelector<HTMLElement>('#hist-status')!;
  try {
    const data = await adminFetch<any>(`/v1/admin/audit?${new URLSearchParams({ q: state.q, kind: state.kind, page: String(state.page) })}`);
    const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0, to = Math.min(data.page * data.pageSize, data.total);
    status.textContent = data.total ? `Showing ${from}–${to} of ${data.total.toLocaleString('en-IN')} changes` : '';
    view.querySelector('#hist-table')!.innerHTML = dataTable(['When', 'Who', 'What happened'],
      data.entries.map((e: any) => [when(e.created_at), esc(e.actor), `<span class="wrap">${describeChange(e)}</span>`]),
      state.q || state.kind !== 'all' ? 'No changes match this search.' : 'No changes yet.');
    prev.disabled = state.page <= 1;
    next.disabled = state.page * data.pageSize >= data.total;
    view.querySelector('#hist-page')!.textContent = `Page ${state.page} of ${Math.max(1, Math.ceil(data.total / data.pageSize))}`;
  } catch (e) {
    status.className = 'error';
    status.textContent = e instanceof Error ? e.message : 'Could not load history';
  }
}
