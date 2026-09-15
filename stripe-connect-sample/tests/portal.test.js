import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
const html=await fs.readFile(new URL("../public/index.html",import.meta.url),"utf8");
const script=await fs.readFile(new URL("../public/portal.js",import.meta.url),"utf8");
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error("DOM flow did not finish");};

for(const role of ["customer","provider"]){
  test(role+" portal renders safely and submits the expected API payload",async()=>{
    const dom=new JSDOM(html,{url:"http://localhost:4242/stripe-connect-sample/public/index.html",runScripts:"outside-only"});
    const {window}=dom,requests=[];
    window.HTMLElement.prototype.scrollIntoView=()=>{};
    const replies={
      "/api/dashboard":{user:{display_name:"Synthetic user",role},bookings:[],notifications:[{subject:"Notice",body:'<img src=x onerror="alert(1)">'}]},
      "/api/care-recipients":{care_recipients:[{id:"recipient-test",preferred_name:"Synthetic recipient"}]},
      "/api/requests":{requests:[]},
      "/api/memberships":{active:true,membership:{status:"active"}},
      "/api/provider/profile":{profile:{bio:"Synthetic profile",experience_years:3,service_zips:["10001"],service_types:["companion"],qualifications:[],availability:{windows:[]},verification_status:"pending",payments_enabled:false}}
    };
    window.fetch=async(url,options={})=>{
      if(options.method){requests.push({url,method:options.method,body:JSON.parse(options.body)});return {status:200,ok:true,json:async()=>({})};}
      assert.ok(replies[url],"Unexpected endpoint "+url);
      return {status:200,ok:true,json:async()=>replies[url]};
    };
    window.eval(script);
    const document=window.document;
    await wait(()=>role==="customer"?document.querySelector("#recipient-select").options.length===1:document.querySelector("#provider-form").elements.bio.value==="Synthetic profile");
    assert.equal(document.querySelector("#dashboard").classList.contains("hidden"),false);
    assert.equal(document.querySelector("#notifications img"),null);
    assert.match(document.querySelector("#notifications").textContent,/<img/);
    if(role==="customer"){
      assert.equal(document.querySelector("#provider-tools").classList.contains("hidden"),true);
      const form=document.querySelector("#request-form");
      form.elements.zip.value="10001";
      form.elements.starts_at.value="2027-01-01T10:00";
      form.elements.duration_minutes.value="90";
      form.dispatchEvent(new window.SubmitEvent("submit",{bubbles:true,cancelable:true,submitter:form.querySelector("button")}));
      await wait(()=>requests.some(r=>r.url==="/api/requests"));
      const sent=requests.find(r=>r.url==="/api/requests").body;
      assert.equal(sent.care_recipient_id,"recipient-test");
      assert.equal(sent.duration_minutes,90);
      assert.equal(sent.service_type,"companion");
      assert.equal(Object.hasOwn(sent,"amount_cents"),false);
    } else {
      assert.equal(document.querySelector("#customer-tools").classList.contains("hidden"),true);
      const form=document.querySelector("#provider-form");
      form.dispatchEvent(new window.SubmitEvent("submit",{bubbles:true,cancelable:true,submitter:form.querySelector('button:not([type="button"])')}));
      await wait(()=>requests.some(r=>r.url==="/api/provider/profile"));
      const sent=requests.find(r=>r.url==="/api/provider/profile").body;
      assert.deepEqual(sent.service_types,["companion"]);
      assert.deepEqual(sent.service_zips,["10001"]);
      assert.equal(sent.experience_years,3);
    }
    await new Promise(r=>setTimeout(r,20));
    dom.window.close();
  });
}
