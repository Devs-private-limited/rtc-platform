import { adminFetch } from './api';
import { isOwner } from './me';
import { ago, dataTable, esc, kpis, minutes, moneyList, num, pageHeader, planBadge, when, yesNo } from './ui';

export async function renderOverviewPage(view: HTMLElement) {
  view.innerHTML = pageHeader('Overview', 'The whole business at a glance. Minutes and messages are for the current month (UTC).') + '<div class="loading">Loading…</div>';
  try {
    const [o, att, summary] = await Promise.all([adminFetch<any>('/v1/admin/overview'), adminFetch<any>('/v1/admin/attention').catch(() => null), adminFetch<any>('/v1/admin/weekly-summary').catch(() => null)]);
    const month = new Date(o.monthStartUtc).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const plans = o.plans || {};
    view.innerHTML =
      pageHeader('Overview', `The whole business at a glance. “This month” = ${esc(month)} (UTC).`, '<button class="secondary" id="ov-refresh">Refresh</button>') +
      attentionSection(att) +
      `<section class="panel"><h2>Customers</h2>${kpis([
        ['Total customers', num(o.customers), `${num(o.verified_customers)} verified email`, '#/customers?view=all'],
        ['New this month', num(o.new_this_month), `${num(o.new_7_days)} in the last 7 days`, '#/customers?joined=month'],
        ['Active (30 days)', num(o.active_30_days), 'used chat or calls in their app', '#/customers?activity=active30'],
        ['Plans', `${num(plans.free || 0)} / ${num(plans.starter || 0)} / ${num(plans.pro || 0)}`, 'Free / Starter / Pro'],
      ])}</section>` +
      `<section class="panel"><h2>Usage this month</h2>${kpis([
        ['Call minutes (customers)', minutes(o.customer_minutes_month), 'participant minutes, all customers'],
        ['Calls', num(o.customer_calls_month), '1:1 calls started'],
        ['Chat messages', num(o.customer_messages_month), 'sent by customers’ users'],
        ['Demo / internal minutes', minutes(o.other_minutes_month), 'demo apps and admin-made projects'],
      ])}</section>` +
      `<section class="panel"><h2>Money</h2>${kpis([
        ['Active subscriptions', num(o.active_subscriptions), 'paid plans currently active', '#/customers?paid=paid'],
        ['Net revenue this month', moneyList(o.revenue_month, 'net_minor'), 'after refunds'],
        ['Net revenue all time', moneyList(o.revenue_all_time, 'net_minor'), `gross ${moneyList(o.revenue_all_time, 'gross_minor')}`],
      ])}<p class="note">From Dodo Payments webhooks. Gateway fees and payouts are in the Dodo dashboard.</p></section>` +
      `<section class="panel"><div class="panel-head"><h2>Latest sign-ups</h2><a class="btn-link" href="#/customers">View all customers</a></div>${dataTable(
        ['Customer', 'Email', 'Plan', 'Email status', 'Signed up'],
        (o.recentSignups || []).map((c: any) => [
          `<a class="strong" href="#/customers/${esc(c.id)}">${esc(c.name || 'No name given')}</a>`,
          esc(c.email),
          planBadge(c.plan),
          yesNo(!!c.email_verified_at),
          `${when(c.created_at)}<div class="sub">${ago(c.created_at)}</div>`,
        ]),
        'No customers yet.',
        (o.recentSignups || []).map((c: any) => `class="clickable" data-href="#/customers/${esc(c.id)}"`)
      )}</section>` + summarySection(summary);
    view.querySelectorAll<HTMLElement>('tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href!)));
    const sendNow = view.querySelector<HTMLButtonElement>('#ov-send-summary');
    if (sendNow) sendNow.onclick = async () => {
      const msg = view.querySelector<HTMLElement>('#ov-summary-msg')!;
      sendNow.disabled = true; msg.className = 'm-msg'; msg.textContent = 'Sending…';
      try {
        const r = await adminFetch<any>('/v1/admin/weekly-summary/send', { method: 'POST', body: '{}' });
        msg.textContent = r.result === 'sent' ? `Sent to ${r.recipients.join(', ')}. Check the inbox (and Spam).` : r.result === 'not-configured' ? 'Not sent: email is not set up on the server.' : 'The email could not be sent. Try again later.';
        if (r.result !== 'sent') { msg.className = 'm-msg error'; sendNow.disabled = false; return; }
        // Sent: keep the button off for 10 minutes (the server enforces this too).
        msg.textContent += ' You can send it again in 10 minutes.';
        setTimeout(() => { sendNow.disabled = false; }, 10 * 60 * 1000);
      } catch (e) { msg.className = 'm-msg error'; msg.textContent = e instanceof Error ? e.message : 'Could not send'; sendNow.disabled = false; }
    };
    view.querySelector<HTMLButtonElement>('#ov-refresh')!.onclick = () => void renderOverviewPage(view);
  } catch (e) {
    view.querySelector('.loading')!.outerHTML = `<div class="error">${esc(e instanceof Error ? e.message : 'Could not load the overview')}</div>`;
  }
}

const GROUPS: [key: string, title: string, tip: string, tone: string][] = [
  ['paymentProblems', 'Payment problems', 'Failed or cancelled payments in the last 30 days. Check the Dodo dashboard and contact the customer.', 'bad'],
  ['cancellations', 'Cancelled or cancelling', 'Paid plans that ended or will end. A short “why did you leave?” email can bring them back.', 'bad'],
  ['nearLimit', 'Near or over their limit', 'Using 80% or more of this month’s allowance: a good moment to suggest an upgrade, or give extra minutes.', 'warn'],
  ['spikes', 'Unusual usage spikes', 'A quarter of the monthly allowance used in 24 hours. Could be a launch, or abuse: take a look.', 'warn'],
  ['neverUsed', 'Signed up, never used their app', 'More than 3 days since sign-up and no chat or calls yet. A friendly “need help getting started?” email helps.', 'info'],
  ['notVerified', 'Email not verified', 'More than 3 days and still not verified. They may have typed a wrong email or missed the message.', 'info'],
];

// Customers-page filters that show the complete list for a group.
const FULL_LIST: Record<string, string> = { notVerified: '#/customers?email=unverified', neverUsed: '#/customers?activity=never' };

function attentionSection(att: any) {
  if (!att) return '';
  const total = GROUPS.reduce((n, [k]) => n + (att[k]?.length || 0), 0);
  if (!total) return `<section class="panel attention ok"><h2>Needs attention</h2><p class="all-good">✓ Nothing needs your attention right now.</p></section>`;
  const cards = GROUPS.filter(([k]) => att[k]?.length).map(([k, title, tip, tone]) => `
    <div class="att-card ${tone}">
      <div class="att-head"><h3>${esc(title)}</h3><span class="att-count">${att[k].length}</span></div>
      <p class="note">${esc(tip)}</p>
      <ul class="att-list">${att[k].map((i: any) => `<li><a class="att-row" href="#/customers/${esc(i.accountId)}"><span><strong>${esc(i.name || i.email)}</strong>${i.name ? `<span class="sub">${esc(i.email)}</span>` : ''}<span class="sub">${esc(i.why)}</span></span>${planBadge(i.plan)}</a></li>`).join('')}</ul>
      ${att[k].length > 5 ? `<p class="note att-more">${att[k].length >= 20 ? 'Newest 20 shown' : `All ${att[k].length} shown`}: scroll inside the box.${FULL_LIST[k] ? ` <a href="${FULL_LIST[k]}">See everyone</a>` : ''}</p>` : ''}
    </div>`).join('');
  return `<section class="panel attention"><div class="panel-head"><h2>Needs attention <span class="att-total">${total}</span></h2></div><div class="att-grid">${cards}</div></section>`;
}

function summarySection(s: any) {
  if (!s) return '';
  const to = s.recipients?.length ? s.recipients.map((r: string) => esc(r)).join(', ') : '<span class="warn-text">no address set</span>';
  return `<section class="panel"><div class="panel-head"><h2>Weekly summary email</h2>${isOwner() ? '<button class="secondary" id="ov-send-summary">Send it now</button>' : ''}</div>
    <p class="note">${esc(s.schedule)}, a short email goes to <strong>${to}</strong> with last week’s new customers, minutes, messages, revenue and everything under “Needs attention”, so you stay up to date without opening this panel.</p>
    <div id="ov-summary-msg" class="m-msg" role="status"></div></section>`;
}
