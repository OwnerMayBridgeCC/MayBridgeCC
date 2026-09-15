import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { commissionRate, serviceAmount, membershipPrice } from "../lib/pricing.js";
import { processPaymentEvent, paidBookingSession, validateMembershipPrice } from "../lib/payments.js";
import { sendRecoveryEmail } from "../lib/email.js";

test("pricing rejects missing commission, inherited plan names and untrusted rates",()=>{
  for(const value of [undefined,""," ","NaN","-1","10001"])assert.throws(()=>commissionRate(value));
  assert.equal(commissionRate("0"),0);
  assert.equal(commissionRate("1250"),1250);
  assert.throws(()=>membershipPrice("toString"));
  assert.equal(serviceAmount("companion",90,'{"companion":4000}'),6000);
  assert.throws(()=>serviceAmount("companion",90,"{}"));
  assert.throws(()=>serviceAmount("companion",-1,'{"companion":4000}'));
  assert.throws(()=>validateMembershipPrice({active:true,currency:"usd",unit_amount:1,recurring:{interval:"month",interval_count:1}},"monthly"));
});

test("recovery email has no success result without delivery configuration or acceptance",async()=>{
  await assert.rejects(sendRecoveryEmail("test@example.com","token",{},()=>{throw Error("must not send")}));
  const env={RESEND_API_KEY:"fake",EMAIL_FROM:"test@example.com",BASE_URL:"https://example.com"};
  await assert.rejects(sendRecoveryEmail("test@example.com","token",env,async()=>({ok:false})));
  let body;
  const result=await sendRecoveryEmail("test@example.com","token",env,async(url,options)=>{
    body=JSON.parse(options.body);
    return {ok:true,json:async()=>({id:"message-test"})};
  });
  assert.equal(result,"message-test");
  assert.match(body.text,/#reset_token=token/);
});

test("real PostgreSQL engine: ownership, booking lifecycle, overlap and webhook reconciliation",async t=>{
  process.env.NODE_ENV="test";
  process.env.STRIPE_SECRET_KEY="sk_test_fake_only_no_network";
  process.env.SERVICE_COMMISSION_BPS="1250";
  const pg=new PGlite({extensions:{pgcrypto,btree_gist}});
  const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.affectedRows || r.rows.length};};
  const adapter={query,connect:async()=>({...adapter,release(){}})};
  for(const name of ["001_marketplace.sql","002_checkout_safety.sql"]){
    await pg.exec(await fs.readFile(new URL("../migrations/"+name,import.meta.url),"utf8"));
  }
  const {setTestDatabase}=await import("../lib/db.js");
  setTestDatabase(adapter);
  const {app}=await import("../server.js");
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await pg.close();});
  const origin="http://127.0.0.1:"+server.address().port;
  const api=async(path,method="GET",body,cookie)=>{
    const response=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,cookie:response.headers.get("set-cookie")?.split(";")[0],data:response.status===204?{}:await response.json()};
  };
  const signup=async(name,role)=>api("/api/auth/signup","POST",{display_name:name,email:name+"@example.com",password:"test password long enough",role});
  const customer=await signup("customer","customer"),other=await signup("other","customer"),provider=await signup("provider","provider");
  assert.equal(customer.status,201);
  assert.equal((await signup("admin","admin")).status,400);
  assert.equal((await api("/api/dashboard")).status,401);
  assert.equal((await api("/api/auth/recovery","POST",{email:"customer@example.com"})).status,503);
  const recipient=await api("/api/care-recipients","POST",{preferred_name:"Synthetic recipient"},customer.cookie);
  const requestBody={care_recipient_id:recipient.data.care_recipient.id,service_type:"companion",zip:"10001",starts_at:new Date(Date.now()+86400000).toISOString(),duration_minutes:60};
  assert.equal((await api("/api/requests","POST",requestBody,other.cookie)).status,404);
  const request=await api("/api/requests","POST",requestBody,customer.cookie);
  assert.equal(request.status,201);
  assert.equal((await api("/api/requests/"+request.data.request.id+"/select","POST",{provider_id:provider.data.user.id,amount_cents:1},customer.cookie)).status,400);
  // Seed a synthetic paid booking to exercise only authorized state transitions.
  const b=(await query("INSERT INTO bookings(request_id,customer_id,provider_id,starts_at,ends_at,amount_cents,commission_cents,stripe_checkout_session_id) VALUES($1,$2,$3,now()-interval '2 hours',now()-interval '1 hour',4000,500,'cs_test') RETURNING *",[request.data.request.id,customer.data.user.id,provider.data.user.id])).rows[0];
  assert.equal((await api("/api/bookings/"+b.id+"/start","POST",{},provider.cookie)).status,409);
  const session={id:"cs_test",mode:"payment",payment_status:"unpaid",amount_total:4000,currency:"usd",payment_intent:"pi_test",metadata:{booking_id:b.id}};
  const stripe={checkout:{sessions:{retrieve:async()=>session}}};
  const event={id:"evt_unpaid",type:"checkout.session.completed",data:{object:session}};
  await processPaymentEvent(adapter,stripe,event);
  assert.equal((await query("SELECT status FROM bookings WHERE id=$1",[b.id])).rows[0].status,"pending_payment");
  session.payment_status="paid";
  assert.equal(paidBookingSession({...session,amount_total:1},b),false);
  await processPaymentEvent(adapter,stripe,{...event,id:"evt_paid",type:"checkout.session.async_payment_succeeded"});
  assert.equal((await query("SELECT status FROM bookings WHERE id=$1",[b.id])).rows[0].status,"booked");
  assert.equal((await api("/api/bookings/"+b.id+"/start","POST",{},customer.cookie)).status,403);
  assert.equal((await api("/api/bookings/"+b.id+"/start","POST",{},provider.cookie)).status,200);
  assert.equal((await api("/api/bookings/"+b.id+"/complete","POST",{},provider.cookie)).status,200);
  assert.equal((await api("/api/bookings/"+b.id+"/confirm","POST",{},other.cookie)).status,409);
  assert.equal((await api("/api/bookings/"+b.id+"/confirm","POST",{},customer.cookie)).status,200);
  // Duplicate paid event does not rewind a completed service to booked.
  await processPaymentEvent(adapter,stripe,{...event,id:"evt_paid"});
  assert.equal((await query("SELECT status FROM bookings WHERE id=$1",[b.id])).rows[0].status,"completed");
  assert.equal((await api("/api/bookings/"+b.id+"/review","POST",{rating:5,body:"Synthetic test"},customer.cookie)).status,201);
  const rq2=await api("/api/requests","POST",requestBody,customer.cookie);
  await assert.rejects(query("INSERT INTO bookings(request_id,customer_id,provider_id,starts_at,ends_at,amount_cents,commission_cents) VALUES($1,$2,$3,now()-interval '90 minutes',now()-interval '30 minutes',4000,500)",[rq2.data.request.id,customer.data.user.id,provider.data.user.id]),e=>e.code==="23P01");
  // Provider edits must invalidate earlier qualification approval.
  await query("UPDATE provider_profiles SET verification_status='verified' WHERE user_id=$1",[provider.data.user.id]);
  await api("/api/provider/profile","PUT",{service_types:["nursing"],qualifications:["licensed"]},provider.cookie);
  assert.equal((await query("SELECT verification_status FROM provider_profiles WHERE user_id=$1",[provider.data.user.id])).rows[0].verification_status,"pending");
  // Subscription creation provisions membership; stale event uses current Stripe status.
  await query("UPDATE users SET stripe_customer_id='cus_test' WHERE id=$1",[customer.data.user.id]);
  const sub={id:"sub_test",customer:"cus_test",metadata:{user_id:customer.data.user.id,interval:"monthly"},status:"active",items:{data:[{price:{id:"price_month"},quantity:1,current_period_end:2000000000}]}};
  stripe.subscriptions={retrieve:async()=>sub};
  const subEvent={id:"evt_sub_created",type:"customer.subscription.created",data:{object:sub}};
  await processPaymentEvent(adapter,stripe,subEvent,{STRIPE_MONTHLY_PRICE_ID:"price_month"});
  assert.equal((await query("SELECT status FROM memberships WHERE customer_id=$1",[customer.data.user.id])).rows[0].status,"active");
  sub.status="canceled";
  await processPaymentEvent(adapter,stripe,{...subEvent,id:"evt_stale"},{STRIPE_MONTHLY_PRICE_ID:"price_month"});
  assert.equal((await query("SELECT status FROM memberships WHERE customer_id=$1",[customer.data.user.id])).rows[0].status,"canceled");
});
