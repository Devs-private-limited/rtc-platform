import { adminFetch } from './api';
import { statusPill } from './customers';
import { dataTable, esc, money, pageHeader, planBadge, when } from './ui';

let page = 1;

export async function renderPaymentsPage(view: HTMLElement) {
  view.innerHTML = pageHeader('Payments', 'Every payment Dodo Payments told us about, newest first. Only “succeeded” payments count as revenue.') + '<div class="loading">Loading…</div>';
  try {
    const data = await adminFetch<any>(`/v1/admin/payments?page=${page}`);
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    view.querySelector('.loading')!.outerHTML =
      `<section class="panel"><p class="note">${data.total} payment records. Fees and payouts are in the Dodo dashboard.</p>${dataTable(
        ['Paid at', 'Customer', 'Plan now', 'What', 'Status', ['Amount', 'num'], ['Refunded', 'num'], 'Payment ID'],
        data.payments.map((p: any) => [
          when(p.paid_at),
          p.account_id ? `<a class="strong" href="#/customers/${esc(p.account_id)}">${esc(p.name || p.email)}</a><div class="sub">${esc(p.email)}</div>` : '<span class="dim">Deleted account</span>',
          planBadge(p.plan),
          esc(p.description || '—'),
          statusPill(p.status),
          money(p.amount_minor, p.currency),
          money(p.refunded_minor, p.currency),
          `<code>${esc(p.payment_id)}</code>`,
        ]),
        'No payments yet.'
      )}<div class="pager"><button class="secondary" id="pay-prev" ${page === 1 ? 'disabled' : ''}>← Previous</button><span>Page ${page} of ${pages}</span><button class="secondary" id="pay-next" ${page >= pages ? 'disabled' : ''}>Next →</button></div></section>`;
    view.querySelector<HTMLButtonElement>('#pay-prev')!.onclick = () => { page--; void renderPaymentsPage(view); };
    view.querySelector<HTMLButtonElement>('#pay-next')!.onclick = () => { page++; void renderPaymentsPage(view); };
  } catch (e) {
    view.querySelector('.loading')!.outerHTML = `<div class="error">${esc(e instanceof Error ? e.message : 'Could not load payments')}</div>`;
  }
}
