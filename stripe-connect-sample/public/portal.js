const $ = selector => document.querySelector(selector);
const msg = text => { $("#message").textContent = text; $("#message").classList.remove("hidden"); };
async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  let data;
  try { data = response.status === 204 ? {} : await response.json(); }
  catch { throw Error("The account service is unavailable. Please try again later."); }
  if (!response.ok) throw Object.assign(Error(data.error || "Request failed"), { status: response.status });
  return data;
}
const post = (url, body = {}) => api(url, { method: "POST", body: JSON.stringify(body) });
async function action(button, fn) {
  button.disabled = true;
  try { await fn(); } catch (error) { msg(error.message); }
  finally { button.disabled = false; }
}
function bookingCard(booking, role) {
  const card = document.createElement("div");
  card.className = "booking";
  card.textContent = booking.status.replaceAll("_", " ") + " · " + new Date(booking.starts_at).toLocaleString();
  const operation = role === "provider" ?
    ({ booked: "start", in_progress: "complete" })[booking.status] :
    booking.status === "provider_completed" ? "confirm" : null;
  if (operation) {
    const button = document.createElement("button");
    button.textContent = {start:"Start service",complete:"Mark service complete",confirm:"Confirm completion"}[operation];
    button.onclick = () => action(button, async () => { await post("/api/bookings/" + booking.id + "/" + operation); await load(); });
    card.append(document.createElement("br"), button);
  }
  if (role==="customer" && booking.status==="completed") {
    const form=document.createElement("form"),ratingLabel=document.createElement("label"),rating=document.createElement("select");
    ratingLabel.textContent="Rate this service";
    for(let i=5;i>=1;i--){const option=document.createElement("option");option.value=String(i);option.textContent=i+" stars";rating.append(option);}
    ratingLabel.append(rating);
    const reviewLabel=document.createElement("label"),review=document.createElement("textarea");reviewLabel.textContent="Your review";review.maxLength=2000;reviewLabel.append(review);
    const submit=document.createElement("button");submit.textContent="Submit review";
    form.append(ratingLabel,reviewLabel,submit);
    form.onsubmit=e=>{e.preventDefault();action(submit,async()=>{await post("/api/bookings/"+booking.id+"/review",{rating:Number(rating.value),body:review.value});form.replaceChildren(paragraph("Review submitted. Thank you."));});};
    card.append(form);
  }
  return card;
}
async function load() {
  try {
    const data = await api("/api/dashboard");
    $("#auth").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    $("#identity").textContent = data.user.display_name + " · " + data.user.role;
    $("#membership").classList.toggle("hidden", data.user.role !== "customer");
    $("#bookings").replaceChildren(...data.bookings.map(booking => bookingCard(booking, data.user.role)));
    if (!data.bookings.length) $("#bookings").textContent = "No services yet. Your confirmed bookings will appear here.";
    // Render notification text as text, never executable HTML.
    $("#notifications").replaceChildren(...data.notifications.map(notification => {
      const div = document.createElement("div");
      div.className = "booking";
      div.textContent = notification.subject + " — " + notification.body;
      return div;
    }));
    if (!data.notifications.length) $("#notifications").textContent = "You have no notifications.";
    $("#customer-tools").classList.toggle("hidden",data.user.role!=="customer");
    $("#provider-tools").classList.toggle("hidden",data.user.role!=="provider");
    $("#admin-tools").classList.toggle("hidden",data.user.role!=="admin");
    if(data.user.role==="customer") await loadCustomer();
    if(data.user.role==="provider") await loadProvider();
    if(data.user.role==="admin") await loadAdmin();
  } catch (error) { if (error.status !== 401) msg(error.message); }
}
for (const id of ["login", "signup", "recovery"]) {
  $("#" + id).onsubmit = event => {
    event.preventDefault();
    action(event.submitter, async () => {
      const result = await post("/api/auth/" + id, Object.fromEntries(new FormData(event.target)));
      if (id === "recovery") msg(result.message);
      else if(id==="signup" && event.target.elements.role.value==="customer"){
        const plan=new FormData(event.target).get("plan")||"monthly";
        try{const checkout=await post("/api/memberships/checkout",{interval:plan});location.assign(checkout.checkout_url);}
        catch(error){msg("Your account was created. "+error.message);await load();}
      } else location.reload();
    });
  };
}
const resetToken = new URLSearchParams(location.hash.slice(1)).get("reset_token");
if (resetToken) {
  history.replaceState(null, "", location.pathname);
  $("#reset").classList.remove("hidden");
  $("#reset").onsubmit = event => {
    event.preventDefault();
    action(event.submitter, async () => {
      await post("/api/auth/reset", { token: resetToken, password: new FormData(event.target).get("password") });
      $("#reset").classList.add("hidden");
      msg("Your password has been reset. Sign in with your new password.");
    });
  };
}
$("#logout").onclick = event => action(event.currentTarget, async () => { await post("/api/auth/logout"); location.reload(); });
for (const button of document.querySelectorAll("[data-plan]")) {
  button.onclick = () => action(button, async () => {
    const data = await post("/api/memberships/checkout", { interval: button.dataset.plan });
    location.assign(data.checkout_url);
  });
}
$("#manage-membership").onclick = event => action(event.currentTarget, async () => {
  const data = await post("/api/memberships/portal");
  location.assign(data.url);
});
const services={companion:"Companion support",transportation:"Transportation and errands",coordination:"Care coordination",respite:"Respite support",personal_care:"Personal care",nursing:"Nursing / licensed care"};
const money=cents=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
function paragraph(text){const p=document.createElement("p");p.textContent=text;return p;}
function button(text,fn){const b=document.createElement("button");b.type="button";b.textContent=text;b.onclick=()=>action(b,fn);return b;}
async function loadCustomer(){
  const [recipients,requests,billing]=await Promise.all([api("/api/care-recipients"),api("/api/requests"),api("/api/memberships")]);
  $("#membership-status").textContent=billing.active ? "Your membership is active." : "No active membership. You can save requests; membership is required to view matches and book.";
  $("#recipients").replaceChildren(...recipients.care_recipients.map(careCard));
  if(!recipients.care_recipients.length)$("#recipients").textContent="Add yourself or a loved one to get started.";
  $("#recipient-select").replaceChildren(...recipients.care_recipients.map(r=>{const option=document.createElement("option");option.value=r.id;option.textContent=r.preferred_name;return option;}));
  $("#requests").replaceChildren(...requests.requests.map(request=>{
    const div=document.createElement("div");div.className="booking";
    div.append(paragraph((services[request.service_type]||request.service_type)+" for "+request.preferred_name+" · "+new Date(request.starts_at).toLocaleString()+" · "+request.status));
    if(request.clinical)div.append(paragraph("This request needs a licensed-care review. Contact support@maybridgecarecollective.com for the next step."));
    else if(request.status==="open")div.append(button("View matched providers",()=>loadMatches(request)));
    return div;
  }));
  if(!requests.requests.length)$("#requests").textContent="No requests yet.";
}
async function loadMatches(request){
  const data=await api("/api/requests/"+request.id+"/matches");
  const target=$("#matches");target.replaceChildren();
  const heading=document.createElement("h3");heading.textContent="Providers for "+(services[request.service_type]||request.service_type);target.append(heading);
  if(!data.matches.length){target.append(paragraph("No verified providers are available for this request yet. Try another time or contact MayBridge support."));return;}
  for(const provider of data.matches){
    const card=document.createElement("article");card.className="card";
    const title=document.createElement("h4");title.textContent=provider.display_name;
    card.append(title,paragraph(provider.headline||"Care professional"),paragraph(provider.bio),paragraph((provider.experience_years??0)+" years of experience · "+provider.completed_services+" completed MayBridge services"),
      paragraph(provider.review_count?provider.rating+"/5 from "+provider.review_count+" reviews":"No MayBridge reviews yet"),
      paragraph("Distance: "+(provider.distance_miles===null?"Service-area match":provider.distance_miles+" miles")+" · Background check: clear · MayBridge approved"),paragraph("Qualifications: "+(provider.qualifications.join(", ")||"None listed")),paragraph("Certifications: "+((provider.certifications||[]).join(", ")||"None listed")+" · Languages: "+((provider.languages||[]).join(", ")||"Not listed")),
      paragraph(data.amount_cents===null?"Service pricing is not yet available.":"Service total: "+money(data.amount_cents)));
    const resume=document.createElement("details"),summary=document.createElement("summary"),resumeBody=document.createElement("div");summary.textContent="View professional résumé";resume.append(summary,resumeBody);for(const [label,items] of [["Work history",provider.work_history],["Education",provider.education]]){const h=document.createElement("h5");h.textContent=label;resumeBody.append(h,...(items||[]).map(item=>paragraph([item.title,item.organization,item.detail].filter(Boolean).join(" · "))));}card.append(resume);
    const reviews=document.createElement("div");
    card.append(button("Read reviews",async()=>{const d=await api("/api/providers/"+provider.id+"/reviews");reviews.replaceChildren(...d.reviews.map(r=>paragraph(r.rating+"/5 · "+r.body)));if(!d.reviews.length)reviews.textContent="No reviews yet."; }),reviews);
    const select=button("Select provider and continue to payment",async()=>{
      const d=await post("/api/requests/"+request.id+"/select",{provider_id:provider.id});location.assign(d.checkout_url);
    });
    select.disabled=data.amount_cents===null||!provider.payments_enabled;
    card.append(select);
    if(!provider.payments_enabled)card.append(paragraph("This provider's payment setup is not complete."));
    target.append(card);
  }
  target.scrollIntoView({behavior:"smooth",block:"start"});
}
$("#recipient-form").onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{await post("/api/care-recipients",Object.fromEntries(new FormData(e.target)));e.target.reset();await loadCustomer();msg("Care recipient saved.");});};
$("#request-form").onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{
  const body=Object.fromEntries(new FormData(e.target));body.duration_minutes=Number(body.duration_minutes);body.starts_at=new Date(body.starts_at).toISOString();body.clinical=body.service_type==="nursing";
  await post("/api/requests",body);await loadCustomer();msg("Your request has been saved. A request is not a confirmed booking.");
});};
let windows=[];
function renderWindows(){
  $("#availability").replaceChildren(...windows.map((window,index)=>{const div=document.createElement("div");div.append(paragraph(new Date(window.starts_at).toLocaleString()+" — "+new Date(window.ends_at).toLocaleString()),button("Remove",async()=>{windows.splice(index,1);renderWindows();}));return div;}));
  if(!windows.length)$("#availability").textContent="Add a time window to be available for matching.";
}
async function loadProvider(){
  const {profile}=await api("/api/provider/profile");
  $("#provider-status").textContent="MayBridge review: "+profile.admin_approval_status+" · Background check: "+profile.background_check_status+" · Credentials: "+profile.verification_status+" · Payments: "+(profile.payments_enabled?"ready":"incomplete");
  const form=$("#provider-form");
  for(const key of ["headline","bio","experience_years","base_zip","service_radius_miles"])form.elements[key].value=profile[key]??"";
  for(const key of ["service_zips","qualifications","certifications","languages"])form.elements[key].value=(profile[key]||[]).join(", ");
  const lines=items=>(items||[]).map(item=>[item.title,item.organization,item.detail].filter(Boolean).join(" | ")).join("\n");
  form.elements.work_history_text.value=lines(profile.work_history);form.elements.education_text.value=lines(profile.education);
  for(const option of form.elements.service_types.options)option.selected=profile.service_types.includes(option.value);
  windows=profile.availability?.windows||[];renderWindows();
}
$("#add-window").onclick=()=>{try{
  const start=new Date($("#available-start").value),end=new Date($("#available-end").value);
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw Error("Choose an availability end after its start.");
  windows.push({starts_at:start.toISOString(),ends_at:end.toISOString()});renderWindows();
}catch(e){msg(e.message)}};
$("#provider-form").onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{
  const data=new FormData(e.target),body=Object.fromEntries(data);
  body.experience_years=Number(body.experience_years);body.service_types=data.getAll("service_types");
  body.service_radius_miles=Number(body.service_radius_miles);
  for(const key of ["service_zips","qualifications","certifications","languages"])body[key]=body[key].split(",").map(s=>s.trim()).filter(Boolean);
  const entries=text=>String(text||"").split("\n").map(line=>{const [title="",organization="",...detail]=line.split("|").map(value=>value.trim());return {title,organization,detail:detail.join(" | ")};}).filter(item=>item.title||item.organization||item.detail);
  body.work_history=entries(body.work_history_text);body.education=entries(body.education_text);delete body.work_history_text;delete body.education_text;
  body.availability={windows};
  await api("/api/provider/profile",{method:"PUT",body:JSON.stringify(body)});await loadProvider();msg("Your profile and availability have been saved.");
});};
$("#verify-provider").onclick=e=>action(e.currentTarget,async()=>{const d=await api("/api/provider/verification");location.assign(d.url);});
$("#signup-role").onchange=e=>$("#signup-plans").classList.toggle("hidden",e.target.value!=="customer");
const query=new URLSearchParams(location.search);if(query.get("signup")==="provider"){$("#signup-role").value="provider";$("#signup-plans").classList.add("hidden");}if(query.get("plan")==="annual")document.querySelector('[name="plan"][value="annual"]').checked=true;
async function loadAdmin(){
  const readiness=await api("/api/admin/launch-status");$("#launch-status").textContent="Approved providers with current screening: "+readiness.approved_providers+". Missing configuration: "+(Object.entries(readiness.configuration).filter(([,ready])=>!ready).map(([key])=>key).join(", ")||"None")+". Payout enrollment: "+(readiness.connect_enabled?"enabled":"not configured");
  const {providers}=await api("/api/admin/providers"),target=$("#admin-providers");target.replaceChildren();
  for(const provider of providers){const card=document.createElement("article");card.className="admin-provider";const title=document.createElement("h4");title.textContent=provider.display_name+" · "+provider.email;card.append(title,paragraph(provider.headline||"No headline"),paragraph((provider.experience_years||0)+" years · "+(provider.base_zip||"No ZIP")+" · "+provider.service_radius_miles+" miles"),paragraph("Services: "+provider.service_types.join(", ")),paragraph("Credentials: "+provider.qualifications.join(", ")));
    const form=document.createElement("form");form.innerHTML='<label>MayBridge approval<select name="admin_approval_status"><option>pending</option><option>approved</option><option>rejected</option><option>suspended</option></select></label><label>Background check<select name="background_check_status"><option>not_started</option><option>pending</option><option>clear</option><option>consider</option><option>failed</option><option>expired</option></select></label><label>Credential verification<select name="verification_status"><option>not_started</option><option>pending</option><option>verified</option><option>rejected</option><option>expired</option></select></label><label>Credential expiry or next review<input name="credentials_expires_at" type="date"></label><label>Background screening next review<input name="background_expires_at" type="date"></label><label>Screening reference<input name="background_check_reference" maxlength="250"></label><button>Save review</button>';
    for(const key of ["admin_approval_status","background_check_status","verification_status"])form.elements[key].value=provider[key];form.elements.background_check_reference.value=provider.background_check_reference||"";for(const key of ["credentials_expires_at","background_expires_at"])form.elements[key].value=provider[key]?.slice(0,10)||"";form.onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{await api("/api/admin/providers/"+provider.id+"/review",{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(form)))});await loadAdmin();msg("Provider review saved.");});};card.append(resumeDetails(provider),form);target.append(card);}
  if(!providers.length)target.textContent="No provider applications yet.";
}

function careCard(recipient){
  const card=document.createElement("details"),summary=document.createElement("summary"),form=document.createElement("form");
  summary.textContent=recipient.preferred_name+(recipient.relationship?" · "+recipient.relationship:"");
  for(const [key,label] of [["preferred_name","Preferred name"],["relationship","Relationship"],["notes","Private care preferences"]]){
    const l=document.createElement("label"),field=document.createElement(key==="notes"?"textarea":"input");l.textContent=label;field.name=key;field.value=recipient[key]||"";field.maxLength=key==="notes"?4000:key==="preferred_name"?150:100;if(key==="preferred_name")field.required=true;l.append(field);form.append(l);
  }
  const save=document.createElement("button");save.textContent="Save care preferences";form.append(save);
  form.onsubmit=e=>{e.preventDefault();action(save,async()=>{await api("/api/care-recipients/"+recipient.id,{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(form)))});await loadCustomer();msg("Care preferences saved.");});};card.append(summary,form);return card;
}
function resumeDetails(provider){
  const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent="View professional résumé";details.append(summary,paragraph(provider.bio||""));
  for(const [label,items] of [["Work history",provider.work_history],["Education",provider.education]]){
    const h=document.createElement("h4");h.textContent=label;details.append(h,...(items||[]).map(item=>paragraph([item.title,item.organization,item.detail].filter(Boolean).join(" · "))));
    if(!items?.length)details.append(paragraph("Not listed."));
  }
  return details;
}
$("#directory-form").onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{
  const params=new URLSearchParams(new FormData(e.target)),data=await api("/api/providers?"+params),target=$("#directory-results");target.replaceChildren();
  for(const provider of data.providers){const card=document.createElement("article"),h=document.createElement("h4");card.className="card";h.textContent=provider.display_name;
    card.append(h,paragraph(provider.headline||"Care professional"),paragraph(provider.distance_miles+" miles · "+(provider.experience_years||0)+" years of experience"),paragraph("MayBridge approved · Current credential and background checks"),paragraph((provider.service_types||[]).map(x=>services[x]||x).join(", ")),paragraph(provider.completed_services+" completed MayBridge services · "+(provider.review_count?provider.rating+"/5 from "+provider.review_count+" reviews":"No reviews yet")),paragraph("Qualifications: "+(provider.qualifications.join(", ")||"Not listed")),paragraph("Languages: "+(provider.languages.join(", ")||"Not listed")),resumeDetails(provider));
    const reviews=document.createElement("div");card.append(button("Read reviews",async()=>{const result=await api("/api/providers/"+provider.id+"/reviews");reviews.replaceChildren(...result.reviews.map(r=>paragraph(r.rating+"/5 · "+r.body)));if(!result.reviews.length)reviews.textContent="No reviews yet.";}),reviews,button("Create a service request",async()=>{$("#request-form").elements.zip.value=params.get("zip");if(params.get("service"))$("#request-form").elements.service_type.value=params.get("service");$("#request-form").scrollIntoView({behavior:"smooth"});msg("Choose the care recipient and time. MayBridge will check provider availability for your request.");}));target.append(card);
  }
  if(!data.providers.length)target.append(paragraph("No approved providers currently match this search. Try a wider radius or a different service."));
  if(data.providers.length===data.limit)target.append(paragraph("Showing the nearest 100 providers. Narrow your search for more specific results."));
});};
$("#connect-provider").onclick=e=>action(e.currentTarget,async()=>{const result=await post("/api/provider/connect/onboarding");location.assign(result.url);});
$("#connect-status").onclick=e=>action(e.currentTarget,async()=>{const result=await post("/api/provider/connect/status");await loadProvider();msg(result.ready?"Payout setup is ready.":"Payout setup needs attention. Continue enrollment or open your Stripe dashboard.");});
$("#connect-dashboard").onclick=e=>action(e.currentTarget,async()=>{const result=await post("/api/provider/connect/dashboard");location.assign(result.url);});
if(query.get("connect"))msg("Refresh payout status to check your setup, or continue enrollment if your link expired.");
if(query.get("membership")==="success")msg("Your checkout has returned. Membership access activates after Stripe confirms your subscription. Refresh this page if confirmation is still processing.");
if(query.get("membership")==="canceled")msg("Checkout was canceled. Your account is saved; choose a plan when you are ready.");
load();

api("/api/readiness").then(status=>{if(!status.accounts){msg("Online account enrollment is temporarily unavailable while setup is completed. Please check back soon.");document.querySelectorAll("#auth button").forEach(b=>b.disabled=true);}else if(!status.checkout_configured){msg("Account access is available. Membership checkout is not available yet; no payment will be collected.");}}).catch(()=>{});
