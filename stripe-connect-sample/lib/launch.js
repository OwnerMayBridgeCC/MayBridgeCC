import { createHash } from 'node:crypto';
import zipcodes from 'zipcodes';
import { db, transaction } from './db.js';
import { SERVICE_TYPES, milesBetween } from './marketplace.js';
import { syncConnect, onboardingLink } from './connect.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
export const currentScreeningSQL = "p.verification_status='verified' AND p.background_check_status='clear' AND p.admin_approval_status='approved' AND p.credentials_expires_at>now() AND p.background_expires_at>now()";
const publicFields=`u.id,u.display_name,p.headline,p.bio,p.experience_years,p.base_zip,p.service_radius_miles,p.service_zips,p.service_types,p.qualifications,p.languages,p.certifications,p.education,p.work_history,p.rating,p.review_count,p.availability,p.payments_enabled,(SELECT count(*)::integer FROM bookings b WHERE b.provider_id=u.id AND b.status='completed') AS completed_services`;

export function authRateLimit(req,res,next) {
  if(req.method!=='POST')return next();
  (async()=>{
    const email=String(req.body?.email||'').trim().toLowerCase();
    const ip=process.env.VERCEL ? String(req.headers['x-vercel-forwarded-for']||req.ip) : req.ip;
    for(const [key,limit] of [[`ip:${ip}`,200],...(email?[[`email:${email}`,20]]:[])]){
      const hash=createHash('sha256').update(key).digest('hex');
      const {rows}=await db().query(`INSERT INTO auth_rate_limits(key_hash,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.expires_at<now() THEN 1 ELSE auth_rate_limits.attempts+1 END,expires_at=CASE WHEN auth_rate_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.expires_at END RETURNING attempts`,[hash]);
      if(rows[0].attempts>limit){res.setHeader('Retry-After','900');throw fail(429,'Too many attempts. Please try again in 15 minutes.');}
    }
    await db().query('DELETE FROM auth_rate_limits WHERE expires_at<now()');
  })().then(()=>next(),next);
}

export function installLaunchRoutes(app,{auth,member,requiredStripe,baseUrl}) {
  app.get('/api/readiness',async(req,res)=>{
    let accounts=false;
    try{await db().query('SELECT credentials_expires_at FROM provider_profiles LIMIT 0');await db().query('SELECT key_hash FROM auth_rate_limits LIMIT 0');accounts=true;}catch{}
    const billing=Boolean((!/^((sk|rk)_live_)/.test(process.env.STRIPE_SECRET_KEY||'')||process.env.LIVE_PAYMENTS_ENABLED==='true')&&accounts&&process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_MONTHLY_PRICE_ID&&process.env.STRIPE_ANNUAL_PRICE_ID&&process.env.STRIPE_WEBHOOK_SECRET);
    res.setHeader('Cache-Control','no-store');res.json({accounts,checkout_configured:billing});
  });

  app.get('/api/providers',auth('customer'),member,async(req,res,next)=>{try{
    const zip=String(req.query.zip||''),radius=Number(req.query.radius||25),service=String(req.query.service||'');
    const target=zipcodes.lookup(zip);
    if(!/^\d{5}$/.test(zip)||!target||!Number.isFinite(radius)||radius<1||radius>250)throw fail(400,'Enter a valid US ZIP code and a radius from 1 to 250 miles.');
    if(service&&!SERVICE_TYPES.includes(service))throw fail(400,'Choose a listed service.');
    if(service==='nursing')throw fail(409,'Nursing requests need a licensed-care review. Please use the service request form.');
    const {rows}=await db().query(`SELECT ${publicFields} FROM provider_profiles p JOIN users u ON u.id=p.user_id WHERE u.disabled_at IS NULL AND ${currentScreeningSQL} AND ($1='' OR $1=ANY(p.service_types)) ORDER BY u.display_name`,[service]);
    const providers=rows.map(p=>({...p,distance_miles:milesBetween(zipcodes.lookup(p.base_zip),target)}))
      .filter(p=>p.distance_miles<=radius&&(p.distance_miles<=p.service_radius_miles||p.service_zips.includes(zip)))
      .sort((a,b)=>a.distance_miles-b.distance_miles).slice(0,100).map(p=>({...p,distance_miles:Math.round(p.distance_miles*10)/10}));
    res.json({providers,limit:100});
  }catch(e){next(e)}});

  app.put('/api/care-recipients/:id',auth('customer'),async(req,res,next)=>{try{
    const name=String(req.body.preferred_name||'').trim();
    if(!name||name.length>150)throw fail(400,'Enter a name up to 150 characters.');
    const {rows}=await db().query('UPDATE care_recipients SET preferred_name=$3,relationship=$4,notes=$5 WHERE id=$1 AND customer_id=$2 RETURNING id,preferred_name,relationship,notes,created_at',[req.params.id,req.user.id,name,String(req.body.relationship||'').slice(0,100),String(req.body.notes||'').slice(0,4000)]);
    if(!rows[0])throw fail(404,'Care recipient not found.');res.json({care_recipient:rows[0]});
  }catch(e){next(e)}});

  app.post('/api/provider/connect/onboarding',auth('provider'),async(req,res,next)=>{try{
    if(process.env.STRIPE_CONNECT_ENABLED!=='true')throw fail(503,'Payout enrollment is not available yet. Contact MayBridge support.');
    const stripe=requiredStripe();
    const accountId=await transaction(async c=>{
      const {rows}=await c.query('SELECT stripe_account_id FROM provider_profiles WHERE user_id=$1 FOR UPDATE',[req.user.id]);
      if(rows[0].stripe_account_id)return rows[0].stripe_account_id;
      const account=await stripe.v2.core.accounts.create({display_name:req.user.display_name,contact_email:req.user.email,dashboard:'express',defaults:{currency:'usd',responsibilities:{fees_collector:'application',losses_collector:'application'}},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{requested:true}}}}},metadata:{maybridge_user_id:req.user.id}},{idempotencyKey:'maybridge-connect-'+req.user.id});
      await c.query('UPDATE provider_profiles SET stripe_account_id=$2 WHERE user_id=$1',[req.user.id,account.id]);return account.id;
    });
    const link=await onboardingLink(stripe,accountId,baseUrl);res.json({url:link.url});
  }catch(e){next(e)}});
  app.post('/api/provider/connect/status',auth('provider'),async(req,res,next)=>{try{
    const {rows}=await db().query('SELECT stripe_account_id FROM provider_profiles WHERE user_id=$1',[req.user.id]);
    if(!rows[0]?.stripe_account_id)return res.json({ready:false});
    const {ready}=await syncConnect(db(),requiredStripe(),rows[0].stripe_account_id);res.json({ready});
  }catch(e){next(e)}});
  app.post('/api/provider/connect/dashboard',auth('provider'),async(req,res,next)=>{try{
    const {rows}=await db().query('SELECT stripe_account_id FROM provider_profiles WHERE user_id=$1',[req.user.id]);
    if(!rows[0]?.stripe_account_id)throw fail(409,'Complete payout enrollment first.');
    const link=await requiredStripe().accounts.createLoginLink(rows[0].stripe_account_id);res.json({url:link.url});
  }catch(e){next(e)}});

  app.get('/api/admin/launch-status',auth('admin'),async(req,res,next)=>{try{
    const keys=['DATABASE_URL','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_MONTHLY_PRICE_ID','STRIPE_ANNUAL_PRICE_ID','SERVICE_COMMISSION_BPS','RESEND_API_KEY','EMAIL_FROM','VERIFICATION_START_URL'];
    const configuration=Object.fromEntries(keys.map(k=>[k,Boolean(process.env[k])]));
    const {rows}=await db().query(`SELECT count(*)::integer AS approved_providers FROM provider_profiles p WHERE ${currentScreeningSQL}`);
    res.json({configuration,...rows[0],connect_enabled:process.env.STRIPE_CONNECT_ENABLED==='true'});
  }catch(e){next(e)}});
}
