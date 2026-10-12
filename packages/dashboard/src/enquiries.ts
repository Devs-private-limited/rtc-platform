import { adminFetch } from './api';
import { escapeHtml } from './customers';
interface Lead { id:string; email:string; company:string|null; source:string; createdAt:string }
export function renderEnquiries(root:HTMLElement,onBack:()=>void,onLogout:()=>void) {
  root.innerHTML=`<header class="top"><div><h1>Customer enquiries</h1><p>Admin only · Website and demo contact requests</p></div><div class="row"><button id="enquiries-back" class="secondary">Projects</button><button id="enquiries-logout" class="secondary">Sign out</button></div></header><section class="card"><p>These requests are saved in the database. Follow up manually; submitting the contact form does not send an email notification. Repeat requests from the same email and source update the existing record and its date.</p><div class="row"><input id="enquiries-search" type="search" placeholder="Search email or company" aria-label="Search loaded enquiries"><select id="enquiries-source" aria-label="Filter source"><option value="">All sources</option><option value="website">Website</option><option value="demo">Demo</option></select><button id="enquiries-refresh">Refresh</button></div><p id="enquiries-status" role="status"></p><div id="enquiries-list" class="customer-table"></div></section>`;
  const search=root.querySelector<HTMLInputElement>('#enquiries-search')!,source=root.querySelector<HTMLSelectElement>('#enquiries-source')!,refresh=root.querySelector<HTMLButtonElement>('#enquiries-refresh')!,status=root.querySelector<HTMLElement>('#enquiries-status')!,list=root.querySelector<HTMLElement>('#enquiries-list')!;
  let rows:Lead[]=[],total=0;
  const active=()=>root.querySelector('#enquiries-list')===list;
  root.querySelector<HTMLButtonElement>('#enquiries-back')!.onclick=onBack;
  root.querySelector<HTMLButtonElement>('#enquiries-logout')!.onclick=onLogout;
  function draw(){
    const q=search.value.trim().toLowerCase();
    const filtered=rows.filter(r=>(!source.value||r.source===source.value)&&`${r.email} ${r.company||''}`.toLowerCase().includes(q));
    status.textContent=`${filtered.length} shown from ${rows.length} loaded; ${total} total enquiries. Latest 500 maximum. Dates use your browser's timezone.`;
    list.innerHTML=`<table><thead><tr><th>Email</th><th>Company / product</th><th>Source</th><th>Last submitted</th><th>Follow up</th></tr></thead><tbody>${filtered.length?filtered.map(r=>`<tr><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.company||'Not provided')}</td><td>${escapeHtml(r.source)}</td><td>${escapeHtml(new Date(r.createdAt).toLocaleString())}</td><td><a href="mailto:${encodeURIComponent(r.email)}?subject=RTCExpress%20enquiry">Compose email</a></td></tr>`).join(''):'<tr><td colspan="5">No matching enquiries.</td></tr>'}</tbody></table>`;
  }
  async function load(){
    refresh.disabled=true;status.textContent='Loading enquiries...';list.replaceChildren();
    try{const data=await adminFetch<{total:number;leads:Lead[]}>('/v1/admin/leads?limit=500');if(!active())return;rows=data.leads;total=data.total;draw();}
    catch(e){if(active()){rows=[];status.textContent=e instanceof Error?e.message:'Unable to load enquiries. Try Refresh.';}}
    finally{if(active())refresh.disabled=false;}
  }
  search.oninput=()=>{if(!refresh.disabled)draw();};source.onchange=()=>{if(!refresh.disabled)draw();};refresh.onclick=()=>void load();
  void load();
}
