import { adminFetch } from './api';
import { isOwner, me, ROLE_NAMES } from './me';
import { dataTable, esc, pageHeader, when } from './ui';

export async function renderTeamPage(view: HTMLElement) {
  view.innerHTML = pageHeader('Admin team', 'Who can sign in to this admin panel, and what they are allowed to do.') + '<div class="loading">Loading…</div>';
  try {
    const data = await adminFetch<any>('/v1/admin/team');
    const rows = [
      ...data.owners.map((o: any) => [
        `<strong>${esc(o.email)}</strong>${o.email === me.email ? ' <span class="sub">(you)</span>' : ''}${o.hasConsoleAccount ? '' : '<div class="sub warn-text">No console account yet: sign up with this email to be able to sign in.</div>'}`,
        '<span class="pill role-owner">Owner</span>',
        '<span class="dim">Set on the server</span>',
        '<span class="dim">—</span>',
        '<span class="dim">Can’t be removed here</span>',
      ]),
      ...data.members.map((m: any) => [
        `<strong>${esc(m.email)}</strong>${m.email === me.email ? ' <span class="sub">(you)</span>' : ''}`,
        `<span class="pill role-${esc(m.role)}">${esc(ROLE_NAMES[m.role] || m.role)}</span>`,
        esc(m.added_by || '—'),
        when(m.created_at, false),
        isOwner() ? `<button class="danger small" data-remove="${esc(m.email)}">Remove access</button>` : '<span class="dim">Owner only</span>',
      ]),
    ];
    view.querySelector('.loading')!.outerHTML = `
      <section class="panel"><h2>Roles</h2>
        <div class="roles">
          <div><span class="pill role-owner">Owner</span><p>Sees and changes everything, and is the only one who can add or remove admins. Owners are set on the server (<code>ADMIN_EMAILS</code>), so they can never be locked out.</p></div>
          <div><span class="pill role-admin">Admin</span><p>Sees everything. Can change a customer’s plan and give extra minutes. Can’t manage the team.</p></div>
          <div><span class="pill role-viewer">View only</span><p>Sees everything, changes nothing. Good for a partner or accountant.</p></div>
        </div>
      </section>
      ${isOwner() ? `<section class="panel"><h2>Add someone</h2>
        <p class="note">They need a normal RTCExpress console account first (sign up at rtc.devsquarelabs.com). Then add their email here; they sign in to this panel with that email and password.</p>
        <form id="team-add" class="toolbar">
          <input name="email" type="email" required maxlength="320" placeholder="their-email@example.com" aria-label="Email">
          <label>Access<select name="role"><option value="viewer">View only</option><option value="admin">Admin</option></select></label>
          <button type="submit">Give access</button>
        </form><div id="team-msg" role="status"></div></section>` : ''}
      <section class="panel"><h2>People with access</h2>${dataTable(['Email', 'Access', 'Added by', 'Added on', ''], rows, 'Nobody yet.')}</section>`;
    const form = view.querySelector<HTMLFormElement>('#team-add');
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form), msg = view.querySelector<HTMLElement>('#team-msg')!, btn = form.querySelector('button')!;
      btn.disabled = true; msg.className = ''; msg.textContent = '';
      try {
        await adminFetch('/v1/admin/team', { method: 'POST', body: JSON.stringify({ email: f.get('email'), role: f.get('role') }) });
        void renderTeamPage(view);
      } catch (err) {
        msg.className = 'error'; msg.textContent = err instanceof Error ? err.message : 'Could not add';
        btn.disabled = false;
      }
    };
    view.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => (b.onclick = async () => {
      if (!confirm(`Remove admin access for ${b.dataset.remove}? They will be signed out of the admin panel at once. Their customer account is not affected.`)) return;
      b.disabled = true;
      try { await adminFetch(`/v1/admin/team/${encodeURIComponent(b.dataset.remove!)}`, { method: 'DELETE' }); void renderTeamPage(view); }
      catch (err) { alert(err instanceof Error ? err.message : 'Could not remove'); b.disabled = false; }
    }));
  } catch (e) {
    view.querySelector('.loading')!.outerHTML = `<div class="error">${esc(e instanceof Error ? e.message : 'Could not load the team')}</div>`;
  }
}
