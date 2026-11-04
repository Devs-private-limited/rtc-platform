import { adminFetch } from './api';
import { ago, dataTable, device, esc, kpis, minutes, money, num, pageHeader, planBadge, usageBar, when, yesNo } from './ui';
import { canEdit } from './me';
import { describeChange } from './history';

// Kept for older imports (enquiries.ts).
export const escapeHtml = esc;

const state = { q: '', plan: 'all', paid: 'all', sort: 'newest', page: 1 };

function subscriptionText(c: any) {
  if (!c.plan || c.plan === 'free') return '<span class="dim">No subscription</span>';
  const parts = [c.billing_period, c.subscription_status].filter(Boolean).map((v: string) => esc(v));
  if (c.subscription_renews_at) parts.push(`${c.subscription_cancel_at_period_end ? 'ends' : 'renews'} ${new Date(c.subscription_renews_at).toLocaleDateString('en-IN')}`);
  return parts.join(' · ') || '<span class="dim">—</span>';
}

export async function renderCustomerList(view: HTMLElement) {
  view.innerHTML =
    pageHeader('Customers', 'Everyone who signed up for an RTCExpress console account. Click a row for full details.') +
    `<section class="panel">
      <form id="cust-filter" class="toolbar">
        <input name="q" type="search" maxlength="200" placeholder="Search name, email, company or App ID" value="${esc(state.q)}" aria-label="Search">
        <label>Plan<select name="plan">${['all', 'free', 'starter', 'pro'].map((v) => `<option value="${v}" ${state.plan === v ? 'selected' : ''}>${v === 'all' ? 'All plans' : v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
        <label>Payments<select name="paid">${[['all', 'Everyone'], ['paid', 'Has paid'], ['unpaid', 'Never paid']].map(([v, l]) => `<option value="${v}" ${state.paid === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Sort by<select name="sort">${[['newest', 'Newest sign-up'], ['minutes_month', 'Most minutes this month'], ['minutes_total', 'Most minutes all time'], ['last_active', 'Recently active'], ['paid', 'Most payments']].map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button type="submit">Apply</button>
      </form>
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
    Object.assign(state, { q: String(f.get('q') || ''), plan: String(f.get('plan')), paid: String(f.get('paid')), sort: String(f.get('sort')), page: 1 });
    void renderCustomerList(view);
  };
  form.querySelectorAll('select').forEach((s) => (s.onchange = () => form.requestSubmit()));
  prev.onclick = () => { state.page--; void renderCustomerList(view); };
  next.onclick = () => { state.page++; void renderCustomerList(view); };
  prev.disabled = next.disabled = true;
  try {
    const { q, plan, paid, sort, page } = state;
    const data = await adminFetch<any>(`/v1/admin/customers?${new URLSearchParams({ q, plan, paid, sort, page: String(page) })}`);
    if (!view.contains(form)) return;
    const limits = data.planLimits || {};
    const from = data.total ? (page - 1) * data.pageSize + 1 : 0, to = Math.min(page * data.pageSize, data.total);
    status.textContent = `Showing ${from}–${to} of ${data.total} customers. Minutes are participant minutes (a 1:1 call counts for both people), the same way plan limits count them.`;
    tableEl.innerHTML = dataTable(
      ['Customer', 'Plan', 'Email', ['Minutes this month', 'num'], ['Minutes all time', 'num'], ['Messages', 'num'], 'Last active', 'Paid', 'Signed up'],
      data.customers.map((c: any) => [
        `<a class="strong" href="#/customers/${esc(c.id)}">${esc(c.name || 'No name given')}</a><div class="sub">${esc(c.email)}</div>${c.company || c.business_name ? `<div class="sub">${esc(c.business_name || c.company)}</div>` : ''}`,
        planBadge(c.plan),
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
  view.innerHTML = '<a class="back" href="#/customers">← All customers</a><div class="loading">Loading customer…</div>';
  try {
    const data = await adminFetch<any>(`/v1/admin/customers/${encodeURIComponent(id)}`);
    const c = data.account, p = data.profile || {};
    const planLimit = data.planLimits?.[c.plan]?.callMinutes, bonus = Number(c.bonus_minutes_month || 0);
    const limit = planLimit === undefined ? undefined : planLimit + bonus;
    const field = (k: string, v: string) => `<div><dt>${esc(k)}</dt><dd>${v || '<span class="dim">Not provided</span>'}</dd></div>`;
    const sourceKnown = c.signup_ip || c.signup_source || c.signup_user_agent;
    view.innerHTML =
      '<a class="back" href="#/customers">← All customers</a>' +
      pageHeader(c.name || c.email, `${esc(c.email)} · ${planBadge(c.plan)} · signed up ${when(c.created_at)}`) +
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
          ${field('IP address', c.signup_ip ? `<code>${esc(c.signup_ip)}</code> · <a href="https://ipinfo.io/${encodeURIComponent(c.signup_ip)}" target="_blank" rel="noopener noreferrer">look up location ↗</a>` : '')}
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
        <button type="submit">Change plan</button><div class="m-msg" role="status"></div>
      </form>
      <form id="m-bonus" class="manage-card">
        <h3>Give extra minutes</h3>
        <p class="note">Adds call minutes for <strong>${esc(month)}</strong> only, on top of the ${planLimit ? `${num(planLimit)}-minute` : ''} plan allowance. Next month goes back to normal.</p>
        <div class="quick">${[500, 1000, 5000].map((m) => `<button type="button" class="secondary small" data-quick="${m}">+${num(m)}</button>`).join('')}</div>
        <label>Minutes<input name="minutes" type="number" min="1" max="1000000" step="1" required placeholder="e.g. 1000"></label>
        <label><span>Reason <span class="sub">(saved in the history)</span></span><input name="note" required maxlength="300" placeholder="e.g. Goodwill after a server issue"></label>
        <button type="submit">Add minutes</button><div class="m-msg" role="status"></div>
        ${grants.length ? `<h4>Extra minutes this month</h4><ul class="grants">${grants.map((g: any) => `<li><span><strong>+${num(g.minutes)} min</strong> · ${esc(g.note || '')}<span class="sub">by ${esc(g.granted_by || '—')}, ${when(g.created_at)}</span></span><button type="button" class="danger small" data-grant="${esc(g.id)}">Remove</button></li>`).join('')}</ul>` : ''}
      </form>
    </div></section>`;
}

function wireManage(view: HTMLElement, c: any) {
  const reload = () => void renderCustomerDetail(view, c.id);
  const submit = (form: HTMLFormElement, url: string, body: () => any, confirmText?: () => string) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = form.querySelector<HTMLElement>('.m-msg')!, btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      if (confirmText && !confirm(confirmText())) return;
      btn.disabled = true; msg.className = 'm-msg'; msg.textContent = 'Saving…';
      try { await adminFetch(url, { method: 'POST', body: JSON.stringify(body()) }); reload(); }
      catch (err) { msg.className = 'm-msg error'; msg.textContent = err instanceof Error ? err.message : 'Could not save'; btn.disabled = false; }
    };
  };
  const plan = view.querySelector<HTMLFormElement>('#m-plan'), bonus = view.querySelector<HTMLFormElement>('#m-bonus');
  if (plan) submit(plan, `/v1/admin/customers/${c.id}/plan`, () => ({ plan: plan.plan.value, reason: plan.reason.value }),
    () => `Move ${c.email} from ${PLAN_NAMES[c.plan] || c.plan} to ${PLAN_NAMES[plan.plan.value]}? No payment is taken.`);
  if (bonus) {
    submit(bonus, `/v1/admin/customers/${c.id}/bonus-minutes`, () => ({ minutes: Number(bonus.minutes.value), note: bonus.note.value }));
    bonus.querySelectorAll<HTMLButtonElement>('[data-quick]').forEach((b) => (b.onclick = () => { bonus.minutes.value = b.dataset.quick!; bonus.note.focus(); }));
    bonus.querySelectorAll<HTMLButtonElement>('[data-grant]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Remove these extra minutes?')) return;
      b.disabled = true;
      try { await adminFetch(`/v1/admin/customers/${c.id}/bonus-minutes/${b.dataset.grant}`, { method: 'DELETE' }); reload(); }
      catch (err) { alert(err instanceof Error ? err.message : 'Could not remove'); b.disabled = false; }
    }));
  }
}
