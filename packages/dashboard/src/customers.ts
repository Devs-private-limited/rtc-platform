import { adminFetch } from './api';

export const escapeHtml=(value:unknown)=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const date=(value:unknown)=>value?escapeHtml(new Date(String(value)).toLocaleString()):'—';
// Integer minor units (cents/paise) -> formatted decimal, without rounding large totals via Number.
function money(value:unknown,currency:unknown='USD'){const n=BigInt(String(value || 0));const c=String(currency || 'USD').toUpperCase();const sym=c==='USD'?'$':c==='INR'?'₹':`${c} `;return `${sym}${(n/100n).toLocaleString('en-IN')}.${String(n%100n).padStart(2,'0')}`;}
// Plan + subscription state in one readable line, e.g. "pro · yearly · active · renews 5/11/2027".
function planLine(c:any){const parts=[c.plan,c.billing_period,c.subscription_status].filter(Boolean).map(String);
  if(c.subscription_renews_at)parts.push(`${c.subscription_cancel_at_period_end?'ends':'renews'} ${new Date(c.subscription_renews_at).toLocaleDateString()}`);return parts.join(' · ');}
const table=(headers:string[],rows:string[][])=>`<div class="customer-table"><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">No records found.</td></tr>`}</tbody></table></div>`;

export function renderCustomers(root:HTMLElement,onBack:()=>void,onLogout:()=>void){
  root.innerHTML=`<header class="top"><div><h1>Customers & payments</h1><p>Admin only · Registered accounts and verified payment records</p></div><div class="row"><button id="customers-back" class="secondary">Projects</button><button id="customers-logout" class="secondary">Sign out</button></div></header>
    <section class="card"><p>Payments come from Dodo Payments webhooks. Only succeeded payments count toward totals; refunds are subtracted. Amounts are in the currency the customer paid. Check the Dodo dashboard for payouts and fees.</p></section>
    <section class="card"><h2>All-time totals</h2><div id="customer-summary" class="customer-summary"></div></section>
    <section class="card"><form id="customer-search" class="row"><input name="q" maxlength="200" placeholder="Search name, email, business or App ID" aria-label="Search customers"><select name="paid" aria-label="Payment filter"><option value="all">All customers</option><option value="paid">Verified paying customers</option><option value="unpaid">No verified payments</option></select><button>Search</button></form><p id="customer-status" role="status"></p><div id="customer-list"></div><div class="row"><button id="customer-prev" class="secondary">Previous</button><span id="customer-page"></span><button id="customer-next" class="secondary">Next</button></div></section><section id="customer-detail" class="card" hidden></section>`;
  const summary=root.querySelector<HTMLElement>('#customer-summary')!,status=root.querySelector<HTMLElement>('#customer-status')!,list=root.querySelector<HTMLElement>('#customer-list')!,detail=root.querySelector<HTMLElement>('#customer-detail')!;
  const form=root.querySelector<HTMLFormElement>('#customer-search')!,prev=root.querySelector<HTMLButtonElement>('#customer-prev')!,next=root.querySelector<HTMLButtonElement>('#customer-next')!;
  let page=1,q='',paid='all',version=0,detailVersion=0;
  const active=()=>root.querySelector('#customer-search')===form;
  root.querySelector<HTMLButtonElement>('#customers-back')!.onclick=onBack;
  root.querySelector<HTMLButtonElement>('#customers-logout')!.onclick=onLogout;
  async function openCustomer(id:string,paymentPage=1){
    const current=++detailVersion;detail.hidden=false;detail.textContent='Loading customer…';
    try{
      const data=await adminFetch<any>(`/v1/admin/customers/${encodeURIComponent(id)}?page=${paymentPage}`);
      if(!active() || current!==detailVersion)return;
      const c=data.account,p=data.profile;
      const pairs=[['Name',c.name],['Email',c.email],['Signup company',c.company],['Project',c.project_name],['App ID',c.app_id],['Plan / subscription',planLine(c)],['Dodo subscription ID',c.dodo_subscription_id],['Account status',c.active?'Active':'Inactive'],['Registered',new Date(c.created_at).toLocaleString()],['Email verified',c.email_verified_at?'Yes':'No'],...Object.entries(p || {}).map(([k,v])=>[k.replaceAll('_',' '),v])];
      detail.innerHTML=`<h2>Customer details</h2><p class="muted">Business information is customer-provided. ${p?'':'No business profile has been submitted yet.'}</p><dl class="customer-profile">${pairs.map(([k,v])=>`<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || 'Not provided')}</dd></div>`).join('')}</dl><h2>Payment history</h2><p class="muted">From Dodo Payments. Times use your browser's timezone. Refunded amounts are shown separately; gateway fees are not included.</p>
      ${table(['Payment ID','What','Status','Amount','Refunded','Paid at'],data.payments.map((p:any)=>[escapeHtml(p.payment_id),escapeHtml(p.description || '—'),escapeHtml(p.status),money(p.amount_minor,p.currency),money(p.refunded_minor,p.currency),date(p.paid_at)]))}
      <div class="row"><button id="payments-prev" class="secondary" ${paymentPage===1?'disabled':''}>Previous payments</button><span>Page ${paymentPage} · ${data.total} records</span><button id="payments-next" class="secondary" ${paymentPage*data.pageSize>=data.total?'disabled':''}>Next payments</button></div>`;
      detail.querySelector<HTMLButtonElement>('#payments-prev')!.onclick=()=>void openCustomer(id,paymentPage-1);
      detail.querySelector<HTMLButtonElement>('#payments-next')!.onclick=()=>void openCustomer(id,paymentPage+1);
      detail.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){if(active() && current===detailVersion)detail.textContent=error instanceof Error?error.message:'Unable to load customer';}
  }
  async function load(){
    const current=++version;status.textContent='Loading…';prev.disabled=true;next.disabled=true;list.innerHTML='';summary.textContent='Loading totals…';detail.hidden=true;++detailVersion;
    try{
      const data=await adminFetch<any>(`/v1/admin/customers?${new URLSearchParams({q,paid,page:String(page)})}`);
      if(!active() || current!==version)return;
      const s=data.summary;
      const totals=(s.totals || []) as any[];const sum=(key:string)=>totals.length?totals.map(t=>money(t[key],t.currency)).join(' + '):money(0);
      summary.innerHTML=[['Registered customers',s.registered_customers],['Active subscriptions',s.active_subscriptions],['Paying customers',s.paying_customers],['Successful payments',s.verified_payments],['Gross paid',sum('gross_minor')],['Refunded',sum('refunds_minor')],['Net paid',sum('net_minor')]].map(([label,value])=>`<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
      status.textContent=`${data.total} matching customers. Totals above cover all customers, regardless of filters.`;
      list.innerHTML=table(['Customer','Business','Plan / subscription','App ID','Signed up','Payments','Total paid','Last paid','Details'],data.customers.map((c:any)=>[`${escapeHtml(c.name || 'Unnamed')}<br>${escapeHtml(c.email)}`,escapeHtml(c.business_name || c.company || 'Not provided'),escapeHtml(planLine(c)),escapeHtml(c.app_id),date(c.created_at),escapeHtml(c.payment_count),money(c.total_paid_minor,c.currency),date(c.last_paid_at),`<button class="secondary" data-customer="${escapeHtml(c.id)}">View details</button>`]));
      list.querySelectorAll<HTMLButtonElement>('[data-customer]').forEach(button=>button.onclick=()=>void openCustomer(button.dataset.customer!));
      prev.disabled=page===1;next.disabled=page*data.pageSize>=data.total;
      root.querySelector('#customer-page')!.textContent=`Page ${page}`;
    }catch(error){if(active() && current===version){summary.textContent='Totals unavailable';status.textContent=error instanceof Error?error.message:'Unable to load customers';}}
  }
  form.onsubmit=event=>{event.preventDefault();const values=new FormData(form);q=String(values.get('q') || '');paid=String(values.get('paid') || 'all');page=1;void load();};
  prev.onclick=()=>{page--;void load();};next.onclick=()=>{page++;void load();};void load();
}
