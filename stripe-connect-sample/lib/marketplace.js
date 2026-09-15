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
  const languages=list(body.languages || [],"languages");
  const certifications=list(body.certifications || [],"certifications");
  const base_zip=String(body.base_zip||"").trim();
  if(base_zip && !/^\d{5}$/.test(base_zip))throw bad("Use a five-digit home ZIP code.");
  const service_radius_miles=Number(body.service_radius_miles??25);
  if(!Number.isInteger(service_radius_miles)||service_radius_miles<1||service_radius_miles>250)throw bad("Choose a service radius from 1 to 250 miles.");
  const experience_years=body.experience_years;
  if(!Number.isInteger(experience_years) || experience_years<0 || experience_years>80)throw bad("Enter experience from 0 to 80 years.");
  const windows=body.availability?.windows || [];
  if(!Array.isArray(windows) || windows.length>100)throw bad("Check availability.");
  for(const window of windows){
    const start=new Date(window.starts_at),end=new Date(window.ends_at);
    if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw bad("Each availability end must follow its start.");
  }
  const entries=(value,name)=>{
    if(!Array.isArray(value)||value.length>20)throw bad("Check "+name+".");
    return value.map(item=>({title:String(item?.title||"").trim().slice(0,150),organization:String(item?.organization||"").trim().slice(0,150),detail:String(item?.detail||"").trim().slice(0,500)})).filter(item=>item.title||item.organization||item.detail);
  };
  return {headline:String(body.headline||"").trim().slice(0,180),bio:String(body.bio||"").slice(0,4000),experience_years,service_zips,service_types,qualifications,languages,certifications,base_zip,service_radius_miles,
    education:entries(body.education||[],"education"),work_history:entries(body.work_history||[],"work history"),
    availability:{windows:windows.map(w=>({starts_at:new Date(w.starts_at).toISOString(),ends_at:new Date(w.ends_at).toISOString()}))}};
}

export function milesBetween(left,right){
  if(!left||!right)return Infinity;
  const rad=value=>value*Math.PI/180,earth=3958.8;
  const dLat=rad(right.latitude-left.latitude),dLon=rad(right.longitude-left.longitude);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(left.latitude))*Math.cos(rad(right.latitude))*Math.sin(dLon/2)**2;
  return earth*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
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
