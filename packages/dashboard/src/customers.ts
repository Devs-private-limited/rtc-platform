import { adminFetch } from './api';
import { ago, dataTable, device, esc, kpis, minutes, money, num, pageHeader, planBadge, usageBar, when, yesNo } from './ui';
import { canEdit, isOwner } from './me';
import { describeChange } from './history';

// Kept for older imports (enquiries.ts).
export const escapeHtml = esc;

const DEFAULTS = { q: '', plan: 'all', paid: 'all', sort: 'newest', joined: 'all', activity: 'all', email: 'all', status: 'all', page: 1 };
const state = { ...DEFAULTS };
const FILTER_LABELS: Record<string, Record<string, string>> = {
  joined: { month: 'joined this month', '7d': 'joined in the last 7 days' },
  activity: { active30: 'active in the last 30 days', never: 'never used their app' },
  email: { verified: 'verified email', unverified: 'email not verified' },
  paid: { paid: 'have paid', unpaid: 'never paid' },
  status: { active: 'not blocked', blocked: 'blocked' },
};

// A link like #/customers?joined=month (from the Overview tiles) opens the list with that filter.
function presetFromHash() {
  const query = location.hash.split('?')[1];
  if (!query) return;
  const p = new URLSearchParams(query);
  Object.assign(state, DEFAULTS);
  for (const k of ['plan', 'paid', 'joined', 'activity', 'email', 'status'] as const) if (p.get(k)) (state as any)[k] = p.get(k);
  history.replaceState(null, '', '#/customers');
}
const opt = (name: string, pairs: [string, string][]) => `<select name="${name}">${pairs.map(([v, l]) => `<option value="${v}" ${(state as any)[name] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
let flash = '';

function subscriptionText(c: any) {
  if (!c.plan || c.plan === 'free') return '<span class="dim">No subscription</span>';
  const parts = [c.billing_period, c.subscription_status].filter(Boolean).map((v: string) => esc(v));
  if (c.subscription_renews_at) parts.push(`${c.subscription_cancel_at_period_end ? 'ends' : 'renews'} ${new Date(c.subscription_renews_at).toLocaleDateString('en-IN')}`);
  return parts.join(' · ') || '<span class="dim">—</span>';
}

export async function renderCustomerList(view: HTMLElement) {
  presetFromHash();
  const active = Object.entries(FILTER_LABELS).filter(([k]) => (state as any)[k] !== 'all').map(([k, m]) => m[(state as any)[k]]).concat(state.plan !== 'all' ? [`on ${state.plan}`] : []);
  view.innerHTML =
    pageHeader('Customers', 'Everyone who signed up for an RTCExpress console account. Click a row for full details.') +
    `<section class="panel">
      <form id="cust-filter" class="toolbar">
        <input name="q" type="search" maxlength="200" placeholder="Search name, email, company or App ID" value="${esc(state.q)}" aria-label="Search">
        <label>Joined${opt('joined', [['all', 'Any time'], ['month', 'This month'], ['7d', 'Last 7 days']])}</label>
        <label>Plan${opt('plan', [['all', 'All plans'], ['free', 'Free'], ['starter', 'Starter'], ['pro', 'Pro']])}</label>
        <label>Activity${opt('activity', [['all', 'Anyone'], ['active30', 'Active in 30 days'], ['never', 'Never used app']])}</label>
        <label>Email${opt('email', [['all', 'Any'], ['verified', 'Verified'], ['unverified', 'Not verified']])}</label>
        <label>Payments${opt('paid', [['all', 'Everyone'], ['paid', 'Has paid'], ['unpaid', 'Never paid']])}</label>
        <label>Account${opt('status', [['all', 'All'], ['active', 'Not blocked'], ['blocked', 'Blocked']])}</label>
        <label>Sort by${opt('sort', [['newest', 'Newest sign-up'], ['minutes_month', 'Most minutes this month'], ['minutes_total', 'Most minutes all time'], ['last_active', 'Recently active'], ['paid', 'Most payments']])}</label>
        <button type="submit">Search</button>
      </form>
      ${active.length ? `<div class="filter-bar"><span>Showing customers who: <strong>${esc(active.join(', '))}</strong></span><button type="button" class="secondary small" id="cust-clear">Clear filters</button></div>` : ''}
      <p id="cust-status" class="note" role="status">Loading…</p>
      <div id="cust-table"></div>
      <div class="pager"><button class="secondary" id="cust-prev">← Previous</button><span id="cust-page"></span><button class="secondary" id="cust-next">Next →</button></div>
    </section>`;
  const form = view.querySelector<HTMLFormElement>('#cust-filter')!;
  const status = view.querySelector<HTMLElement>('#cust-status')!;
  const tableEl = view.querySelector<HTMLElement>('#cust-table')!;
  const prev = view.querySelector<HTMLButtonElement>('#cust-prev')!, next = view.querySelector<HTMLButtonElement>('#cust-next')!;
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    Object.assign(state, { q: String(f.get('q') || ''), plan: String(f.get('plan')), paid: String(f.get('paid')), sort: String(f.get('sort')), joined: String(f.get('joined')), activity: String(f.get('activity')), email: String(f.get('email')), status: String(f.get('status')), page: 1 });
    void renderCustomerList(view);
  };
  form.querySelectorAll('select').forEach((s) => (s.onchange = () => form.requestSubmit()));
  const clear = view.querySelector<HTMLButtonElement>('#cust-clear');
  if (clear) clear.onclick = () => { Object.assign(state, DEFAULTS); void renderCustomerList(view); };
  prev.onclick = () => { state.page--; void renderCustomerList(view); };
  next.onclick = () => { state.page++; void renderCustomerList(view); };
  prev.disabled = next.disabled = true;
  try {
    const { page } = state;
    const data = await adminFetch<any>(`/v1/admin/customers?${new URLSearchParams(Object.fromEntries(Object.entries(state).map(([k, v]) => [k, String(v)])))}`);
    if (!view.contains(form)) return;
    const limits = data.planLimits || {};
    const from = data.total ? (page - 1) * data.pageSize + 1 : 0, to = Math.min(page * data.pageSize, data.total);
    status.textContent = `Showing ${from}–${to} of ${data.total} customers. Minutes are participant minutes (a 1:1 call counts for both people), the same way plan limits count them.`;
    tableEl.innerHTML = dataTable(
      ['Customer', 'Plan', 'Email', ['Minutes this month', 'num'], ['Minutes all time', 'num'], ['Messages', 'num'], 'Last active', 'Paid', 'Signed up'],
      data.customers.map((c: any) => [
        `<a class="strong" href="#/customers/${esc(c.id)}">${esc(c.name || 'No name given')}</a><div class="sub">${esc(c.email)}</div>${c.company || c.business_name ? `<div class="sub">${esc(c.business_name || c.company)}</div>` : ''}`,
        planBadge(c.plan) + (c.active === false ? ' <span class="pill bad">Blocked</span>' : ''),
        yesNo(!!c.email_verified_at),
        usageBar(Number(c.minutes_month), limits[c.plan] ? limits[c.plan].callMinutes + Number(c.bonus_minutes_month || 0) : undefined) + (Number(c.bonus_minutes_month) ? `<div class="sub">incl. +${num(c.bonus_minutes_month)} extra</div>` : ''),
        minutes(c.minutes_total),
        num(c.messages_total),
        ago(c.last_active_at),
        Number(c.payment_count) ? `${money(c.total_paid_minor, c.currency)}<div class="sub">${num(c.payment_count)} payment${c.payment_count == 1 ? '' : 's'}</div>` : '<span class="dim">—</span>',
        `${when(c.created_at, false)}<div class="sub">${ago(c.created_at)}</div>`,
      ]),
      'No customers match these filters.',
      data.customers.map((c: any) => `class="clickable" data-href="#/customers/${esc(c.id)}"`)
    );
    tableEl.querySelectorAll<HTMLElement>('tr[data-href]').forEach((tr) => (tr.onclick = (e) => { if (!(e.target as HTMLElement).closest('a')) location.hash = tr.dataset.href!; }));
    prev.disabled = page === 1;
    next.disabled = page * data.pageSize >= data.total;
    view.querySelector('#cust-page')!.textContent = `Page ${page} of ${Math.max(1, Math.ceil(data.total / data.pageSize))}`;
  } catch (e) {
    status.innerHTML = `<span class="error">${esc(e instanceof Error ? e.message : 'Could not load customers')}</span>`;
  }
}

export async function renderCustomerDetail(view: HTMLElement, id: string) {
  view.innerHTML = '<a class="btn-link btn-back" href="#/customers"><span aria-hidden="true">←</span> Back to customers</a><div class="loading">Loading customer…</div>';
  try {
    const data = await adminFetch<any>(`/v1/admin/customers/${encodeURIComponent(id)}`);
    const c = data.account, p = data.profile || {};
    const planLimit = data.planLimits?.[c.plan]?.callMinutes, bonus = Number(c.bonus_minutes_month || 0);
    const limit = planLimit === undefined ? undefined : planLimit + bonus;
    const field = (k: string, v: string) => `<div><dt>${esc(k)}</dt><dd>${v || '<span class="dim">Not provided</span>'}</dd></div>`;
    const sourceKnown = c.signup_ip || c.signup_source || c.signup_user_agent;
    view.innerHTML =
      '<a class="btn-link btn-back" href="#/customers"><span aria-hidden="true">←</span> Back to customers</a>' +
      pageHeader(c.name || c.email, `${esc(c.email)} · ${planBadge(c.plan)}${c.active ? '' : ' <span class="pill bad">Blocked</span>'} · signed up ${when(c.created_at)}`) +
      (flash ? `<div class="flash" role="status">${flash}</div>` : '') +
      manageSection(c, data, planLimit) +
      `<section class="panel"><h2>Usage</h2>${kpis([
        ['Minutes this month', usageBar(Number(c.minutes_month), limit), limit ? `${data.planLimits[c.plan].name} plan ${num(planLimit)}${bonus ? ` + ${num(bonus)} extra` : ''}` : ''],
        ['Minutes all time', minutes(c.minutes_total)],
        ['Calls (1:1)', num(c.calls_total)],
        ['Messages', `${num(c.messages_total)}`, `${num(c.messages_month)} this month`],
        ['Last active in app', ago(c.last_active_at)],
      ])}
      <h3>Last 6 months</h3>${dataTable(['Month', ['Call minutes', 'num'], ['Calls', 'num'], ['Messages', 'num']],
        (data.monthly || []).map((m: any) => [esc(new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })), minutes(m.minutes), num(m.calls), num(m.messages)]))}
      <h3>Latest calls</h3>${dataTable(['Started', 'Type', 'From → to', ['Length', 'num'], 'Ended because'],
        (data.recentCalls || []).map((k: any) => [when(k.started_at), esc(k.call_type || 'voice'), `${esc(k.caller_user_id)} → ${esc(k.callee_user_id || '—')}`, k.ended_at ? minutes(k.minutes) : '<span class="pill warn">In progress</span>', esc(k.end_reason || '—')]),
        'No calls yet.')}</section>` +
      `<section class="panel"><h2>Account</h2><dl class="facts">
        ${field('Name', esc(c.name))}${field('Email', esc(c.email))}${field('Email status', yesNo(!!c.email_verified_at))}
        ${field('Company (at sign-up)', esc(c.company))}${field('Project name', esc(c.project_name))}${field('App ID', `<code>${esc(c.app_id)}</code>`)}
        ${field('Plan', planBadge(c.plan))}${field('Subscription', subscriptionText(c))}${field('Dodo subscription ID', esc(c.dodo_subscription_id))}
        ${field('Account', c.active ? '<span class="pill good">Active</span>' : '<span class="pill bad">Disabled</span>')}${field('Signed up', when(c.created_at))}
      </dl></section>` +
      `<section class="panel"><h2>Where this sign-up came from</h2>${sourceKnown
        ? `<dl class="facts">
          ${field('IP address', c.signup_ip ? `<code>${esc(c.signup_ip)}</code> <a class="btn-link small" href="https://ipinfo.io/${encodeURIComponent(c.signup_ip)}" target="_blank" rel="noopener noreferrer">Look up location</a>` : '')}
          ${field('Device', esc(device(c.signup_user_agent)))}
          ${field('Came from', esc(c.signup_source))}
          ${field('Browser details', `<span class="sub">${esc(c.signup_user_agent)}</span>`)}</dl>`
        : `<p class="note">Not recorded. Sign-up tracking started on 4 Nov 2026, so accounts made before that only have the email, name and date above. Their app usage (above) still shows whether they really built something.</p>`}</section>` +
      `<section class="panel"><h2>Business profile</h2>${data.profile
        ? `<dl class="facts">${Object.entries(p).filter(([k]) => k !== 'updated_at').map(([k, v]) => field(k.replaceAll('_', ' '), esc(v))).join('')}</dl>`
        : '<p class="note">The customer has not filled in a business profile.</p>'}</section>` +
      `<section class="panel"><h2>Payments</h2>${dataTable(['Paid at', 'What', 'Status', ['Amount', 'num'], ['Refunded', 'num'], 'Payment ID'],
        data.payments.map((x: any) => [when(x.paid_at), esc(x.description || '—'), statusPill(x.status), money(x.amount_minor, x.currency), money(x.refunded_minor, x.currency), `<code>${esc(x.payment_id)}</code>`]),
        'No payments yet.')}</section>` +
      `<section class="panel"><h2>Admin changes for this customer</h2>${dataTable(['When', 'Who', 'What happened'],
        (data.history || []).map((h: any) => [when(h.created_at), esc(h.actor), `<span class="wrap">${describeChange(h)}</span>`]), 'No admin changes yet.')}</section>`;
    flash = '';
    wireManage(view, c);
  } catch (e) {
    view.querySelector('.loading')!.outerHTML = `<div class="error">${esc(e instanceof Error ? e.message : 'Could not load the customer')}</div>`;
  }
}

export function statusPill(status: unknown) {
  const s = String(status || '');
  const tone = s === 'succeeded' ? 'good' : s === 'failed' || s === 'cancelled' ? 'bad' : 'warn';
  return `<span class="pill ${tone}">${esc(s || 'unknown')}</span>`;
}

const PLAN_NAMES: Record<string, string> = { free: 'Free', starter: 'Starter', pro: 'Pro' };
const EMAIL_NOTE: Record<string, string> = { sent: 'The customer was emailed.', skipped: 'No email was sent (you unticked it).', 'not-configured': 'No email was sent: email is not set up on the server.', failed: 'The email to the customer could not be sent. The change itself is saved.' };

function manageSection(c: any, data: any, planLimit: number | undefined) {
  if (!canEdit()) return `<section class="panel"><h2>Manage</h2><p class="note">Your access is view-only, so you can’t change plans or minutes.</p></section>`;
  const paid = c.plan !== 'free' && c.subscription_status === 'active';
  const grants = data.bonusGrants || [];
  const month = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `<section class="panel manage"><h2>Manage</h2>
    <div class="manage-grid">
      <form id="m-plan" class="manage-card">
        <h3>Change plan</h3>
        <p class="note">Moves the customer to another plan right away, <strong>without any payment</strong>. Use it for friends, partners, testing or fixing a mistake.</p>
        ${paid ? `<p class="warn-box">This customer pays through Dodo (${esc(c.billing_period || '')} subscription, active). Changing the plan here does <strong>not</strong> change or cancel what Dodo charges. Do that in the Dodo dashboard if needed.</p>` : ''}
        <label>New plan<select name="plan">${Object.keys(PLAN_NAMES).map((p) => `<option value="${p}" ${p === c.plan ? 'selected disabled' : ''}>${PLAN_NAMES[p]}${p === c.plan ? ' (current)' : ''}</option>`).join('')}</select></label>
        <label><span>Reason <span class="sub">(saved in the history)</span></span><input name="reason" required maxlength="300" placeholder="e.g. Friend testing Pro features"></label>
        <label class="check"><input type="checkbox" name="notify" checked> Email the customer about this</label>
        <button type="submit">Change plan</button><div class="m-msg" role="status"></div>
      </form>
      <form id="m-bonus" class="manage-card">
        <h3>Give extra minutes</h3>
        <p class="note">Adds call minutes for <strong>${esc(month)}</strong> only, on top of the ${planLimit ? `${num(planLimit)}-minute` : ''} plan allowance. Next month goes back to normal.</p>
        <div class="quick">${[500, 1000, 5000].map((m) => `<button type="button" class="secondary small" data-quick="${m}">+${num(m)}</button>`).join('')}</div>
        <label>Minutes<input name="minutes" type="number" min="1" max="1000000" step="1" required placeholder="e.g. 1000"></label>
        <label><span>Reason <span class="sub">(saved in the history)</span></span><input name="note" required maxlength="300" placeholder="e.g. Goodwill after a server issue"></label>
        <label class="check"><input type="checkbox" name="notify" checked> Email the customer (“complimentary minutes added”)</label>
        <button type="submit">Add minutes</button><div class="m-msg" role="status"></div>
        ${grants.length ? `<h4>Extra minutes this month</h4><ul class="grants">${grants.map((g: any) => `<li><span><strong>+${num(g.minutes)} min</strong> · ${esc(g.note || '')}<span class="sub">by ${esc(g.granted_by || '—')}, ${when(g.created_at)}</span></span><button type="button" class="danger small" data-grant="${esc(g.id)}">Remove</button></li>`).join('')}</ul>` : ''}
      </form>
      ${accessCard(c, data)}
    </div></section>`;
}

function accessCard(c: any, data: any) {
  const hasPayments = Number(data.total || 0) > 0 || (c.plan !== 'free' && c.subscription_status === 'active');
  return `<div class="manage-card access-card">
    <h3>Account access</h3>
    ${c.active
      ? `<form id="m-block"><p class="note"><strong>Block</strong> stops this customer from signing in, signs them out now, and stops their app from starting new chats or calls. Nothing is deleted; you can unblock any time.</p>
        <label><span>Reason <span class="sub">(saved in the history)</span></span><input name="reason" required maxlength="300" placeholder="e.g. Spam sign-up, abuse, unpaid"></label>
        <button type="submit" class="danger">Block customer</button><div class="m-msg" role="status"></div></form>`
      : `<form id="m-block"><p class="warn-box">This customer is <strong>blocked</strong>: they can’t sign in and their app can’t start chats or calls.</p>
        <label><span>Reason for unblocking <span class="sub">(saved in the history)</span></span><input name="reason" required maxlength="300" placeholder="e.g. Sorted out with the customer"></label>
        <button type="submit">Unblock customer</button><div class="m-msg" role="status"></div></form>`}
    <hr>
    ${!isOwner() ? '<p class="note">Only the owner can delete a customer.</p>'
      : hasPayments ? '<p class="note"><strong>Delete</strong> isn’t possible: this customer has payment records, which must be kept for accounts and tax. Block them instead.</p>'
      : `<form id="m-delete"><p class="note"><strong>Delete</strong> permanently removes the account, their project, chat messages and call history. It can’t be undone. Use it for spam or test accounts.</p>
        <label><span>Type <strong>${esc(c.email)}</strong> to confirm</span><input name="confirmEmail" required autocomplete="off" spellcheck="false"></label>
        <label><span>Reason <span class="sub">(saved in the history)</span></span><input name="reason" required maxlength="300" placeholder="e.g. Test account"></label>
        <button type="submit" class="danger">Delete permanently</button><div class="m-msg" role="status"></div></form>`}
  </div>`;
}

function wireManage(view: HTMLElement, c: any) {
  const reload = () => void renderCustomerDetail(view, c.id);
  const block = view.querySelector<HTMLFormElement>('#m-block'), del = view.querySelector<HTMLFormElement>('#m-delete');
  if (block) block.onsubmit = async (e) => {
    e.preventDefault();
    if (c.active && !confirm(`Block ${c.email}? They are signed out now and their app stops working until you unblock them.`)) return;
    const msg = block.querySelector<HTMLElement>('.m-msg')!, btn = block.querySelector<HTMLButtonElement>('button')!;
    btn.disabled = true; msg.className = 'm-msg'; msg.textContent = 'Saving…';
    try { await adminFetch(`/v1/admin/customers/${c.id}/access`, { method: 'POST', body: JSON.stringify({ blocked: !!c.active, reason: block.reason.value }) }); flash = c.active ? 'Customer blocked.' : 'Customer unblocked.'; reload(); }
    catch (err) { msg.className = 'm-msg error'; msg.textContent = err instanceof Error ? err.message : 'Could not save'; btn.disabled = false; }
  };
  if (del) del.onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm(`Permanently delete ${c.email} and all their data? This can't be undone.`)) return;
    const msg = del.querySelector<HTMLElement>('.m-msg')!, btn = del.querySelector<HTMLButtonElement>('button')!;
    btn.disabled = true; msg.className = 'm-msg'; msg.textContent = 'Deleting…';
    try { await adminFetch(`/v1/admin/customers/${c.id}`, { method: 'DELETE', body: JSON.stringify({ confirmEmail: del.confirmEmail.value, reason: del.reason.value }) }); location.hash = '#/customers'; }
    catch (err) { msg.className = 'm-msg error'; msg.textContent = err instanceof Error ? err.message : 'Could not delete'; btn.disabled = false; }
  };
  const submit = (form: HTMLFormElement, url: string, body: () => any, confirmText?: () => string) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = form.querySelector<HTMLElement>('.m-msg')!, btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      if (confirmText && !confirm(confirmText())) return;
      btn.disabled = true; msg.className = 'm-msg'; msg.textContent = 'Saving…';
      try {
        const res = await adminFetch<any>(url, { method: 'POST', body: JSON.stringify(body()) });
        flash = `${url.endsWith('/plan') ? 'Plan changed.' : 'Extra minutes added.'} ${EMAIL_NOTE[res.customerEmail] || ''}`;
        reload();
      }
      catch (err) { msg.className = 'm-msg error'; msg.textContent = err instanceof Error ? err.message : 'Could not save'; btn.disabled = false; }
    };
  };
  const plan = view.querySelector<HTMLFormElement>('#m-plan'), bonus = view.querySelector<HTMLFormElement>('#m-bonus');
  if (plan) submit(plan, `/v1/admin/customers/${c.id}/plan`, () => ({ plan: plan.plan.value, reason: plan.reason.value, notify: plan.notify.checked }),
    () => `Move ${c.email} from ${PLAN_NAMES[c.plan] || c.plan} to ${PLAN_NAMES[plan.plan.value]}? No payment is taken.`);
  if (bonus) {
    submit(bonus, `/v1/admin/customers/${c.id}/bonus-minutes`, () => ({ minutes: Number(bonus.minutes.value), note: bonus.note.value, notify: bonus.notify.checked }));
    bonus.querySelectorAll<HTMLButtonElement>('[data-quick]').forEach((b) => (b.onclick = () => { bonus.minutes.value = b.dataset.quick!; bonus.note.focus(); }));
    bonus.querySelectorAll<HTMLButtonElement>('[data-grant]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Remove these extra minutes?')) return;
      b.disabled = true;
      try { await adminFetch(`/v1/admin/customers/${c.id}/bonus-minutes/${b.dataset.grant}`, { method: 'DELETE' }); reload(); }
      catch (err) { alert(err instanceof Error ? err.message : 'Could not remove'); b.disabled = false; }
    }));
  }
}
