export const SERVICE_TYPES = ["companion","transportation","coordination","respite","personal_care","nursing"];
const bad = message => Object.assign(new Error(message), {status:400});
export function validateProfile(body) {
  const list = (value, name) => {
    if (!Array.isArray(value) || value.length > 100 || value.some(v=>typeof v!=="string" || !v.trim() || v.length>100)) throw bad("Check "+name+".");
    return [...new Set(value.map(v=>v.trim()))];
  };
  const service_zips=list(body.service_zips || [],"ZIP codes");
  if(service_zips.some(zip=>!/^\d{5}$/.test(zip)))throw bad("Use five-digit ZIP codes.");
  const service_types=list(body.service_types || [],"service types");
  if(service_types.some(type=>!SERVICE_TYPES.includes(type)))throw bad("Choose a supported service.");
  const qualifications=list(body.qualifications || [],"qualifications");
  const experience_years=body.experience_years;
  if(!Number.isInteger(experience_years) || experience_years<0 || experience_years>80)throw bad("Enter experience from 0 to 80 years.");
  const windows=body.availability?.windows || [];
  if(!Array.isArray(windows) || windows.length>100)throw bad("Check availability.");
  for(const window of windows){
    const start=new Date(window.starts_at),end=new Date(window.ends_at);
    if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw bad("Each availability end must follow its start.");
  }
  return {bio:String(body.bio||"").slice(0,4000),experience_years,service_zips,service_types,qualifications,
    availability:{windows:windows.map(w=>({starts_at:new Date(w.starts_at).toISOString(),ends_at:new Date(w.ends_at).toISOString()}))}};
}
export function isAvailable(availability, startsAt, duration) {
  const start=+new Date(startsAt),end=start+duration*60000;
  return Array.isArray(availability?.windows) && availability.windows.some(w=>+new Date(w.starts_at)<=start && +new Date(w.ends_at)>=end);
}
export async function activeMembership(database,userId) {
  const {rows}=await database.query("SELECT interval,status,current_period_end FROM memberships WHERE customer_id=$1",[userId]);
  const membership=rows[0] || null;
  return {membership,active:membership?.status==="active" && +new Date(membership.current_period_end)>Date.now()};
}
