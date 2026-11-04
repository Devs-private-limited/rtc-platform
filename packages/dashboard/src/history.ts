import { adminFetch } from './api';
import { dataTable, esc, pageHeader, when } from './ui';

// One readable sentence per admin change.
export function describeChange(e: any) {
  const d = e.detail || {};
  switch (e.action) {
    case 'plan.change': return `Changed plan of <strong>${esc(d.email)}</strong> from ${esc(d.from)} to <strong>${esc(d.to)}</strong>. Reason: ${esc(d.reason)}`;
    case 'minutes.add': return `Gave <strong>${esc(Number(d.minutes).toLocaleString('en-IN'))} extra minutes</strong> to ${esc(d.email)} for ${esc(d.month)}. Reason: ${esc(d.note)}`;
    case 'minutes.remove': return `Removed ${esc(Number(d.minutes).toLocaleString('en-IN'))} extra minutes from ${esc(d.email)} (${esc(d.month)})`;
    case 'team.set': return `Gave <strong>${esc(e.target)}</strong> ${d.role === 'viewer' ? 'view-only' : 'admin'} access`;
    case 'team.remove': return `Removed admin access for <strong>${esc(e.target)}</strong>`;
    default: return esc(e.action);
  }
}

export async function renderHistoryPage(view: HTMLElement) {
  view.innerHTML = pageHeader('Change history', 'Every change made in this admin panel: who did it, what, and when. Nothing here can be edited or deleted.') + '<div class="loading">Loading…</div>';
  try {
    const data = await adminFetch<any>('/v1/admin/audit?limit=200');
    view.querySelector('.loading')!.outerHTML = `<section class="panel">${dataTable(['When', 'Who', 'What happened'],
      data.entries.map((e: any) => [when(e.created_at), esc(e.actor), `<span class="wrap">${describeChange(e)}</span>`]), 'No changes yet.')}</section>`;
  } catch (e) {
    view.querySelector('.loading')!.outerHTML = `<div class="error">${esc(e instanceof Error ? e.message : 'Could not load history')}</div>`;
  }
}
