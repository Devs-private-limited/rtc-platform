import { adminFetch } from './api';
import { ago, dataTable, esc, kpis, minutes, moneyList, num, pageHeader, planBadge, when, yesNo } from './ui';

export async function renderOverviewPage(view: HTMLElement) {
  view.innerHTML = pageHeader('Overview', 'The whole business at a glance. Minutes and messages are for the current month (UTC).') + '<div class="loading">Loading…</div>';
  try {
    const o = await adminFetch<any>('/v1/admin/overview');
    const month = new Date(o.monthStartUtc).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const plans = o.plans || {};
    view.innerHTML =
      pageHeader('Overview', `The whole business at a glance. “This month” = ${esc(month)} (UTC).`, '<button class="secondary" id="ov-refresh">Refresh</button>') +
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
      )}</section>`;
    view.querySelectorAll<HTMLElement>('tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href!)));
    view.querySelector<HTMLButtonElement>('#ov-refresh')!.onclick = () => void renderOverviewPage(view);
  } catch (e) {
    view.querySelector('.loading')!.outerHTML = `<div class="error">${esc(e instanceof Error ? e.message : 'Could not load the overview')}</div>`;
  }
}
