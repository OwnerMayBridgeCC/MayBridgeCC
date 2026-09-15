import "dotenv/config";
import express from "express";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, transaction } from "./lib/db.js";
import { SESSION_COOKIE, hashPassword, verifyPassword, randomToken, tokenHash, parseCookies, sessionCookie } from "./lib/auth.js";
import { membershipPrice, applicationFee, commissionRate, serviceAmount } from "./lib/pricing.js";

import { processPaymentEvent, validateMembershipPrice } from "./lib/payments.js";
import { requireRecoveryEmail, sendRecoveryEmail } from "./lib/email.js";
import { SERVICE_TYPES, validateProfile, isAvailable, activeMembership } from "./lib/marketplace.js";

const app=express(), port=Number(process.env.PORT||4242), baseUrl=(process.env.BASE_URL||`http://localhost:${port}`).replace(/\/$/,"");
const stripe=process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const integrationTag=id=>"maybridge_"+Array.from(createHash("sha256").update(id).digest().subarray(0,8),b=>String.fromCharCode(97+b%26)).join("");
const cleanEmail=v=>String(v||"").trim().toLowerCase();
const requiredStripe=()=>{if(!stripe)throw fail(503,"Stripe is not configured.");return stripe};
async function currentUser(req){const token=parseCookies(req.headers.cookie)[SESSION_COOKIE];if(!token)return null;const {rows}=await db().query(`SELECT u.id,u.email,u.role,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled_at IS NULL`,[tokenHash(token)]);return rows[0]||null}
const auth=(...roles)=>async(req,res,next)=>{try{req.user=await currentUser(req);if(!req.user)throw fail(401,"Sign in required.");if(roles.length&&!roles.includes(req.user.role))throw fail(403,"You do not have permission for this action.");next()}catch(e){next(e)}};

const member=async(req,res,next)=>{try{if(!(await activeMembership(db(),req.user.id)).active)throw fail(402,"An active membership is required to view matches and book providers.");next()}catch(e){next(e)}};

// Raw signed webhooks must precede JSON parsing. A stored event ID makes retries idempotent.
app.post("/webhooks/stripe", express.raw({type:"application/json"}), async(req,res,next)=>{
  try {
    const client = requiredStripe();
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw fail(503,"Webhook is not configured.");
    let event;
    try { event = client.webhooks.constructEvent(req.body,req.headers["stripe-signature"],process.env.STRIPE_WEBHOOK_SECRET); }
    catch { throw fail(400,"Invalid webhook signature."); }
    await transaction(c=>processPaymentEvent(c,client,event));
    res.json({received:true});
  } catch(e) { next(e); }
});
app.use(express.json({limit:"64kb"}));
app.use("/api",(req,res,next)=>{
  res.setHeader("Cache-Control","no-store");
  if(!["GET","HEAD","OPTIONS"].includes(req.method) && req.headers.origin && req.headers.origin!==new URL(baseUrl).origin) return next(fail(403,"Untrusted request origin."));
  next();
});

app.post("/api/auth/signup",async(req,res,next)=>{try{const role=req.body?.role;if(!["customer","provider"].includes(role))throw fail(400,"Choose a customer or provider account.");const email=cleanEmail(req.body.email), name=String(req.body.display_name||"").trim();if(!/^\S+@\S+\.\S+$/.test(email)||!name)throw fail(400,"A valid email and display name are required.");const password=hashPassword(req.body.password);const token=randomToken();const user=await transaction(async c=>{const {rows}=await c.query("INSERT INTO users(email,password_hash,role,display_name) VALUES($1,$2,$3,$4) RETURNING id,email,role,display_name",[email,password,role,name]);if(role==="provider")await c.query("INSERT INTO provider_profiles(user_id) VALUES($1)",[rows[0].id]);await c.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '14 days')",[rows[0].id,tokenHash(token)]);return rows[0]});res.setHeader("Set-Cookie",sessionCookie(token));res.status(201).json({user})}catch(e){if(e.code==="23505")e=fail(409,"An account with that email already exists.");next(e)}});
app.post("/api/auth/login",async(req,res,next)=>{try{const {rows}=await db().query("SELECT * FROM users WHERE lower(email)=$1 AND disabled_at IS NULL",[cleanEmail(req.body.email)]), user=rows[0];if(!user||!verifyPassword(String(req.body.password||""),user.password_hash))throw fail(401,"Email or password is incorrect.");const token=randomToken();await db().query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '14 days')",[user.id,tokenHash(token)]);res.setHeader("Set-Cookie",sessionCookie(token));res.json({user:{id:user.id,email:user.email,role:user.role,display_name:user.display_name}})}catch(e){next(e)}});
app.post("/api/auth/logout",auth(),async(req,res,next)=>{try{const token=parseCookies(req.headers.cookie)[SESSION_COOKIE];await db().query("DELETE FROM sessions WHERE token_hash=$1",[tokenHash(token)]);res.setHeader("Set-Cookie",sessionCookie("",0));res.status(204).end()}catch(e){next(e)}});
app.get("/api/me",auth(),(req,res)=>res.json({user:req.user}));
app.post("/api/auth/recovery", async(req,res,next)=>{
  try {
    requireRecoveryEmail();
    const email=cleanEmail(req.body.email);
    const {rows}=await db().query("SELECT id FROM users WHERE lower(email)=$1 AND disabled_at IS NULL",[email]);
    if(rows[0]){
      const token=randomToken(),hash=tokenHash(token);
      await db().query("INSERT INTO recovery_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[rows[0].id,hash]);
      try { await sendRecoveryEmail(email,token); }
      catch(e) { await db().query("DELETE FROM recovery_tokens WHERE token_hash=$1",[hash]); throw e; }
    }
    res.json({message:"If the account exists, a password reset email has been requested."});
  } catch(e){next(e)}
});
app.post("/api/auth/reset",async(req,res,next)=>{try{const password=hashPassword(req.body.password), hash=tokenHash(String(req.body.token||""));const result=await transaction(async c=>{const {rows}=await c.query("UPDATE recovery_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING user_id",[hash]);if(!rows[0])throw fail(400,"Recovery link is invalid or expired.");await c.query("UPDATE users SET password_hash=$1 WHERE id=$2",[password,rows[0].user_id]);await c.query("DELETE FROM sessions WHERE user_id=$1",[rows[0].user_id]);return true});res.json({reset:result})}catch(e){next(e)}});

app.get("/api/dashboard",auth(),async(req,res,next)=>{try{const bookings=await db().query("SELECT id,starts_at,status,amount_cents,provider_id,customer_id FROM bookings WHERE customer_id=$1 OR provider_id=$1 ORDER BY starts_at DESC",[req.user.id]);const notifications=await db().query("SELECT id,kind,subject,body,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30",[req.user.id]);res.json({user:req.user,bookings:bookings.rows,notifications:notifications.rows})}catch(e){next(e)}});
app.post("/api/care-recipients",auth("customer"),async(req,res,next)=>{try{const name=String(req.body.preferred_name||"").trim();if(!name)throw fail(400,"Preferred name is required.");const {rows}=await db().query("INSERT INTO care_recipients(customer_id,preferred_name,relationship,notes) VALUES($1,$2,$3,$4) RETURNING id,preferred_name,relationship,created_at",[req.user.id,name,req.body.relationship||null,req.body.notes||null]);res.status(201).json({care_recipient:rows[0]})}catch(e){next(e)}});
app.get("/api/care-recipients",auth("customer"),async(req,res,next)=>{try{const {rows}=await db().query("SELECT id,preferred_name,relationship,created_at FROM care_recipients WHERE customer_id=$1 ORDER BY created_at",[req.user.id]);res.json({care_recipients:rows})}catch(e){next(e)}});
app.put("/api/provider/profile",auth("provider"),async(req,res,next)=>{try{const b=validateProfile(req.body),{rows}=await db().query("UPDATE provider_profiles SET bio=$2,experience_years=$3,service_zips=$4,service_types=$5,qualifications=$6,availability=$7,verification_status=CASE WHEN qualifications IS DISTINCT FROM $6::text[] OR service_types IS DISTINCT FROM $5::text[] THEN 'pending' ELSE verification_status END WHERE user_id=$1 RETURNING *",[req.user.id,String(b.bio||""),b.experience_years,b.service_zips||[],b.service_types||[],b.qualifications||[],b.availability||{}]);res.json({profile:rows[0]})}catch(e){next(e)}});
app.post("/api/requests",auth("customer"),async(req,res,next)=>{try{const b=req.body, own=await db().query("SELECT 1 FROM care_recipients WHERE id=$1 AND customer_id=$2",[b.care_recipient_id,req.user.id]);if(!own.rowCount)throw fail(404,"Care recipient not found.");const starts=new Date(b.starts_at);if(!SERVICE_TYPES.includes(b.service_type)||!/^\d{5}$/.test(b.zip)||Number.isNaN(+starts)||starts<=new Date())throw fail(400,"Service, five-digit ZIP, and future start time are required.");if(!Number.isInteger(b.duration_minutes)||b.duration_minutes<1||b.duration_minutes>1440)throw fail(400,"Choose a duration between 1 and 1440 minutes.");const clinical=Boolean(b.clinical)||/nurs|clinical|medical/i.test(b.service_type);const qualifications=clinical?[...(b.required_qualifications||[]),"licensed"]:b.required_qualifications||[];const {rows}=await db().query("INSERT INTO service_requests(customer_id,care_recipient_id,service_type,zip,starts_at,duration_minutes,clinical,required_qualifications) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[req.user.id,b.care_recipient_id,b.service_type,b.zip,starts,b.duration_minutes,clinical,[...new Set(qualifications)]]);res.status(201).json({request:rows[0]})}catch(e){next(e)}});
app.get("/api/requests/:id/matches",auth("customer"),member,async(req,res,next)=>{try{const request=await db().query("SELECT * FROM service_requests WHERE id=$1 AND customer_id=$2",[req.params.id,req.user.id]);if(!request.rowCount)throw fail(404,"Request not found.");const r=request.rows[0];if(r.clinical)throw fail(409,"Licensed care requests require credential and service-area review before matching. Contact MayBridge support.");const {rows}=await db().query(`SELECT u.id,u.display_name,p.bio,p.experience_years,p.service_types,p.qualifications,p.verification_status,p.rating,p.review_count,p.payments_enabled,p.availability,(SELECT count(*)::integer FROM bookings done WHERE done.provider_id=p.user_id AND done.status='completed') AS completed_services FROM provider_profiles p JOIN users u ON u.id=p.user_id WHERE u.disabled_at IS NULL AND p.verification_status='verified' AND $1=ANY(p.service_zips) AND $2=ANY(p.service_types) AND p.qualifications @> $3::text[] AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.provider_id=p.user_id AND b.status<>'canceled' AND tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange($4::timestamptz,$4::timestamptz+($5||' minutes')::interval,'[)')) ORDER BY p.rating DESC NULLS LAST,u.display_name`,[r.zip,r.service_type,r.required_qualifications,r.starts_at,r.duration_minutes]);let amount_cents=null;try{amount_cents=serviceAmount(r.service_type,r.duration_minutes,process.env.SERVICE_HOURLY_RATES_JSON)}catch(e){if(e.status!==503)throw e}res.json({matches:rows.filter(p=>isAvailable(p.availability,r.starts_at,r.duration_minutes)),amount_cents})}catch(e){next(e)}});
app.post("/api/requests/:id/select",auth("customer"),member,async(req,res,next)=>{
  try {
    const client=requiredStripe(),bps=commissionRate(process.env.SERVICE_COMMISSION_BPS);
    if(Object.hasOwn(req.body,"amount_cents")) throw fail(400,"Prices are calculated by MayBridge.");
    const booking=await transaction(async c=>{
      const rq=await c.query("SELECT * FROM service_requests WHERE id=$1 AND customer_id=$2 FOR UPDATE",[req.params.id,req.user.id]);
      const r=rq.rows[0];
      if(!r || !["open","selected"].includes(r.status)) throw fail(409,"Request is unavailable.");
      const existing=(await c.query("SELECT b.*,p.stripe_account_id FROM bookings b JOIN provider_profiles p ON p.user_id=b.provider_id WHERE b.request_id=$1",[r.id])).rows[0];
      if(existing){
        if(existing.status!=="pending_payment" || existing.provider_id!==req.body.provider_id) throw fail(409,"Request already has a booking.");
        return existing;
      }
      if(r.clinical)throw fail(409,"Licensed care requests require credential and service-area review before booking.");
      if(new Date(r.starts_at)<=new Date())throw fail(409,"Choose a future service time.");
      const provider=(await c.query("SELECT p.* FROM provider_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND u.disabled_at IS NULL AND $2=ANY(service_zips) AND $3=ANY(service_types) AND qualifications @> $4::text[] FOR UPDATE OF p",[req.body.provider_id,r.zip,r.service_type,r.required_qualifications])).rows[0];
      if(!provider || provider.verification_status!=="verified")throw fail(400,"Provider is not eligible.");
      if(!isAvailable(provider.availability,r.starts_at,r.duration_minutes))throw fail(409,"Provider is not available at this time.");
      if(!provider.payments_enabled || !provider.stripe_account_id)throw fail(409,"Provider cannot accept payments yet.");
      const amount=serviceAmount(r.service_type,r.duration_minutes,process.env.SERVICE_HOURLY_RATES_JSON);
      const fee=applicationFee(amount,bps),end=new Date(+new Date(r.starts_at)+r.duration_minutes*60000);
      const result=await c.query("INSERT INTO bookings(request_id,customer_id,provider_id,starts_at,ends_at,amount_cents,commission_cents) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[r.id,req.user.id,req.body.provider_id,r.starts_at,end,amount,fee]);
      await c.query("UPDATE service_requests SET status='selected' WHERE id=$1",[r.id]);
      return {...result.rows[0],stripe_account_id:provider.stripe_account_id};
    });
    // Fixed booking values and idempotency key let network failures be retried
    // without creating a second charge or leaving the request permanently stuck.
    const session=booking.stripe_checkout_session_id ?
      await client.checkout.sessions.retrieve(booking.stripe_checkout_session_id) :
      await client.checkout.sessions.create({
        mode:"payment",integration_identifier:integrationTag(booking.id),
        line_items:[{price_data:{currency:"usd",product_data:{name:"MayBridge care service"},unit_amount:booking.amount_cents},quantity:1}],
        payment_intent_data:{application_fee_amount:booking.commission_cents,transfer_data:{destination:booking.stripe_account_id}},
        metadata:{booking_id:booking.id},
        success_url:baseUrl+"/stripe-connect-sample/public/index.html?booking=success",
        cancel_url:baseUrl+"/stripe-connect-sample/public/index.html?booking=canceled"
      },{idempotencyKey:"booking-"+booking.id});
    await db().query("UPDATE bookings SET stripe_checkout_session_id=$1 WHERE id=$2",[session.id,booking.id]);
    if(session.status!=="open" || !session.url)throw fail(409,"Checkout is completed or expired. Contact support to reconcile this booking.");
    res.status(201).json({booking_id:booking.id,amount_cents:booking.amount_cents,checkout_url:session.url});
  }catch(e){next(e)}
});
app.post("/api/bookings/:id/start",auth("provider"),async(req,res,next)=>{
  try{
    const {rows}=await db().query("UPDATE bookings SET status='in_progress' WHERE id=$1 AND provider_id=$2 AND status='booked' AND starts_at<=now() RETURNING id,status",[req.params.id,req.user.id]);
    if(!rows[0])throw fail(409,"Only your paid booking at its scheduled time can be started.");
    res.json({booking:rows[0]});
  }catch(e){next(e)}
});
app.post("/api/bookings/:id/complete",auth("provider"),async(req,res,next)=>{try{const {rows}=await db().query("UPDATE bookings SET status='provider_completed' WHERE id=$1 AND provider_id=$2 AND status='in_progress' RETURNING id,status",[req.params.id,req.user.id]);if(!rows[0])throw fail(409,"Only an in-progress service can be completed.");res.json({booking:rows[0]})}catch(e){next(e)}});
app.post("/api/bookings/:id/confirm",auth("customer"),async(req,res,next)=>{try{const {rows}=await db().query("UPDATE bookings SET status='completed',customer_confirmed_at=now(),completed_at=now() WHERE id=$1 AND customer_id=$2 AND status='provider_completed' RETURNING id,status",[req.params.id,req.user.id]);if(!rows[0])throw fail(409,"This service is not ready for confirmation.");res.json({booking:rows[0]})}catch(e){next(e)}});
app.post("/api/bookings/:id/review",auth("customer"),async(req,res,next)=>{try{const rating=Number(req.body.rating);if(!Number.isInteger(rating)||rating<1||rating>5)throw fail(400,"Rating must be from 1 to 5.");const review=await transaction(async c=>{const booking=await c.query("SELECT provider_id FROM bookings WHERE id=$1 AND customer_id=$2 AND status='completed'",[req.params.id,req.user.id]);if(!booking.rowCount)throw fail(403,"Only completed services may be reviewed.");const {rows}=await c.query("INSERT INTO reviews(booking_id,customer_id,provider_id,rating,body) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.params.id,req.user.id,booking.rows[0].provider_id,rating,String(req.body.body||"").slice(0,2000)]);await c.query("UPDATE provider_profiles SET rating=(SELECT avg(rating) FROM reviews WHERE provider_id=$1),review_count=(SELECT count(*) FROM reviews WHERE provider_id=$1) WHERE user_id=$1",[booking.rows[0].provider_id]);return rows[0]});res.status(201).json({review})}catch(e){next(e)}});
app.post("/api/memberships/checkout",auth("customer"),async(req,res,next)=>{
  try{
    const client=requiredStripe(),interval=req.body.interval;
    membershipPrice(interval);
    const priceId=interval==="monthly"?process.env.STRIPE_MONTHLY_PRICE_ID:process.env.STRIPE_ANNUAL_PRICE_ID;
    if(!priceId)throw fail(503,"Membership pricing is not configured.");
    validateMembershipPrice(await client.prices.retrieve(priceId),interval);
    await transaction(async c=>{
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[req.user.id]);
      const m=(await c.query("SELECT * FROM memberships WHERE customer_id=$1",[req.user.id])).rows[0];
      if(m?.stripe_subscription_id){
        const sub=await client.subscriptions.retrieve(m.stripe_subscription_id);
        if(!["canceled","incomplete_expired"].includes(sub.status))throw fail(409,"You already have a subscription. Use Manage membership.");
      }
      if(m?.checkout_session_id){
        const previous=await client.checkout.sessions.retrieve(m.checkout_session_id);
        if(previous.status==="open"){
          if(m.interval!==interval)throw fail(409,"Finish or expire your existing checkout before changing plans.");
          return;
        }
        if(previous.status==="complete" && !m.stripe_subscription_id)throw fail(409,"Your membership payment is being processed.");
      } else if(m?.checkout_attempt_id && m.interval!==interval){
        throw fail(409,"Retry the previously selected plan before changing plans.");
      }
      await c.query("INSERT INTO memberships(customer_id,interval,checkout_attempt_id) VALUES($1,$2,gen_random_uuid()) ON CONFLICT(customer_id) DO UPDATE SET interval=EXCLUDED.interval,stripe_subscription_id=NULL,status='pending',checkout_attempt_id=CASE WHEN memberships.checkout_session_id IS NULL THEN COALESCE(memberships.checkout_attempt_id,EXCLUDED.checkout_attempt_id) ELSE EXCLUDED.checkout_attempt_id END,checkout_session_id=NULL",[req.user.id,interval]);
    });
    const session=await transaction(async c=>{
      const user=(await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE",[req.user.id])).rows[0];
      const membership=(await c.query("SELECT * FROM memberships WHERE customer_id=$1",[user.id])).rows[0];
      if(membership?.stripe_subscription_id){
        const sub=await client.subscriptions.retrieve(membership.stripe_subscription_id);
        if(!["canceled","incomplete_expired"].includes(sub.status))throw fail(409,"You already have a subscription. Use Manage membership.");
      }
      if(membership?.checkout_session_id){
        const previous=await client.checkout.sessions.retrieve(membership.checkout_session_id);
        if(previous.status==="open"){
          if(membership.interval!==interval)throw fail(409,"Finish or expire your existing checkout before changing plans.");
          return previous;
        }
        if(previous.status==="complete" && !membership.stripe_subscription_id)throw fail(409,"Your membership payment is being processed.");
      }
      let customer=user.stripe_customer_id;
      if(!customer){
        customer=(await client.customers.create({email:user.email,name:user.display_name,metadata:{user_id:user.id}},{idempotencyKey:"customer-"+user.id})).id;
        await c.query("UPDATE users SET stripe_customer_id=$1 WHERE id=$2",[customer,user.id]);
      }
      // The reserved attempt survives transaction rollback after a network failure.
      const attempt=(await c.query("SELECT checkout_attempt_id FROM memberships WHERE customer_id=$1",[user.id])).rows[0].checkout_attempt_id;
      const result=await client.checkout.sessions.create({
        customer,mode:"subscription",integration_identifier:integrationTag(attempt),line_items:[{price:priceId,quantity:1}],
        metadata:{user_id:user.id,interval},subscription_data:{metadata:{user_id:user.id,interval,checkout_attempt_id:attempt}},
        success_url:baseUrl+"/stripe-connect-sample/public/index.html?membership=success",
        cancel_url:baseUrl+"/stripe-connect-sample/public/index.html?membership=canceled"
      },{idempotencyKey:"membership-"+user.id+"-"+attempt});
      await c.query("UPDATE memberships SET checkout_session_id=$1 WHERE customer_id=$2",[result.id,user.id]);
      return result;
    });
    res.json({checkout_url:session.url});
  }catch(e){next(e)}
});
app.post("/api/memberships/portal",auth("customer"),async(req,res,next)=>{
  try{
    const customer=(await db().query("SELECT stripe_customer_id FROM users WHERE id=$1",[req.user.id])).rows[0]?.stripe_customer_id;
    if(!customer)throw fail(409,"No billing account exists yet.");
    const session=await requiredStripe().billingPortal.sessions.create({customer,return_url:baseUrl+"/stripe-connect-sample/public/index.html"});
    res.json({url:session.url});
  }catch(e){next(e)}
});

app.get("/api/memberships",auth("customer"),async(req,res,next)=>{try{res.json(await activeMembership(db(),req.user.id))}catch(e){next(e)}});
app.get("/api/requests",auth("customer"),async(req,res,next)=>{try{const {rows}=await db().query("SELECT r.*,c.preferred_name FROM service_requests r JOIN care_recipients c ON c.id=r.care_recipient_id WHERE r.customer_id=$1 ORDER BY r.created_at DESC LIMIT 100",[req.user.id]);res.json({requests:rows})}catch(e){next(e)}});
app.get("/api/provider/profile",auth("provider"),async(req,res,next)=>{try{const {rows}=await db().query("SELECT * FROM provider_profiles WHERE user_id=$1",[req.user.id]);res.json({profile:rows[0]})}catch(e){next(e)}});
app.get("/api/providers/:id/reviews",auth("customer"),member,async(req,res,next)=>{try{const {rows}=await db().query("SELECT rating,body,created_at FROM reviews WHERE provider_id=$1 ORDER BY created_at DESC LIMIT 30",[req.params.id]);res.json({reviews:rows})}catch(e){next(e)}});
app.get("/api/provider/verification",auth("provider"),async(req,res,next)=>{try{const value=process.env.VERIFICATION_START_URL;if(!value)throw fail(503,"Verification enrollment is not available yet. Contact support.");const url=new URL(value);if(url.protocol!=="https:")throw fail(503,"Verification enrollment is not available.");res.json({url:url.href})}catch(e){next(e)}});

app.use("/stripe-connect-sample/public",express.static(path.join(path.dirname(fileURLToPath(import.meta.url)),"public")));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)),"public")));
app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const status=err.status||(["23505","23P01"].includes(err.code)?409:500);if(status>=500)console.error(err.message);res.status(status).json({error:status>=500?"The service is temporarily unavailable.":err.message})});
if(process.env.NODE_ENV!=="test" && !process.env.VERCEL)app.listen(port,()=>console.log(`MayBridge marketplace listening at ${baseUrl}`));
export { app };
export default app;
