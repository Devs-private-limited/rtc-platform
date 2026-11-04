import { adminFetch } from './api';
import { esc, num, pageHeader } from './ui';

const FEATURES: [string, string][] = [['chat', 'Chat'], ['voice', '1:1 voice calls'], ['video', '1:1 video calls'], ['groupVoice', 'Group voice'], ['groupVideo', 'Group video'], ['screenShare', 'Screen share'], ['recording', 'Call recording'], ['transcription', 'Transcription']];

export async function renderPlansPage(view: HTMLElement) {
  view.innerHTML = pageHeader('Plans & prices', 'What each plan costs and includes right now. This page is read-only.') + '<div class="loading">Loading…</div>';
  try {
    const { plans } = await adminFetch<any>('/v1/admin/billing/plans');
    const ids = Object.keys(plans);
    const row = (label: string, cell: (p: any) => string) => `<tr><th scope="row">${esc(label)}</th>${ids.map((id) => `<td>${cell(plans[id])}</td>`).join('')}</tr>`;
    const price = (usd: number, per: string) => (usd ? `<strong>$${num(usd)}</strong> <span class="sub">/ ${per}</span>` : '<strong>Free</strong>');
    const yes = (ok: boolean) => (ok ? '<span class="tick">✓</span>' : '<span class="dim">—</span>');
    view.querySelector('.loading')!.outerHTML = `
      <section class="panel"><div class="table-wrap"><table class="data compare">
        <thead><tr><th></th>${ids.map((id) => `<th><span class="pill plan-${esc(id)}">${esc(plans[id].name)}</span><div class="sub plan-desc">${esc(plans[id].description)}</div></th>`).join('')}</tr></thead>
        <tbody>
          <tr class="group"><td colspan="${ids.length + 1}">Price</td></tr>
          ${row('Monthly', (p) => price(p.price.monthlyUsd, 'month'))}
          ${row('Yearly', (p) => price(p.price.yearlyUsd, 'year'))}
          <tr class="group"><td colspan="${ids.length + 1}">Included every month</td></tr>
          ${row('Voice call minutes', (p) => `${num(p.limits.voiceMinutes)} min`)}
          ${row('Video call minutes', (p) => (p.limits.videoMinutes ? `${num(p.limits.videoMinutes)} min` : '<span class="dim">—</span>'))}
          ${row('Chat messages', (p) => num(p.limits.messages))}
          ${row('Recordings', (p) => (p.limits.recordings ? num(p.limits.recordings) : '<span class="dim">—</span>'))}
          <tr class="group"><td colspan="${ids.length + 1}">Features</td></tr>
          ${FEATURES.map(([k, l]) => row(l, (p) => yes(!!p.features[k]))).join('')}
        </tbody></table></div>
        <p class="note">Minutes are participant minutes per calendar month (UTC). Limits are allowances, not hard stops: at 80% the customer gets a warning and is asked to upgrade.</p>
      </section>
      <section class="panel how"><h2>How to change these</h2>
        <div class="how-grid">
          <div><h3>Give one customer more</h3><p>Open the customer → <strong>Manage</strong> → <em>Give extra minutes</em> or <em>Change plan</em>. This is the normal way and needs no code change.</p></div>
          <div><h3>Change a price</h3><p>Prices are charged by <strong>Dodo Payments</strong>. Change the product price in the Dodo dashboard first, then ask Claude to update the website, docs and this page so everything matches.</p></div>
          <div><h3>Change what a plan includes</h3><p>Plan minutes and features are also shown on the website and docs. Ask Claude to change them everywhere at once, so customers never see two different numbers.</p></div>
        </div>
      </section>`;
  } catch (e) {
    view.querySelector('.loading')!.outerHTML = `<div class="error">${esc(e instanceof Error ? e.message : 'Could not load plans')}</div>`;
  }
}
