import test from "node:test"; import assert from "node:assert/strict";
import { hashPassword, verifyPassword, parseCookies } from "../lib/auth.js";
import { membershipPrice, applicationFee } from "../lib/pricing.js";
test("password hashes are salted and verifiable",()=>{const a=hashPassword("correct horse battery");const b=hashPassword("correct horse battery");assert.notEqual(a,b);assert.equal(verifyPassword("correct horse battery",a),true);assert.equal(verifyPassword("wrong password here",a),false)});
test("annual membership saves exactly $40",()=>{assert.equal(membershipPrice("monthly"),2000);assert.equal(membershipPrice("annual"),20000);assert.equal(membershipPrice("monthly")*12-membershipPrice("annual"),4000)});
test("commission uses configured basis points",()=>{assert.equal(applicationFee(10000,1250),1250);assert.throws(()=>applicationFee(10000,undefined))});
test("cookie parser reads opaque session",()=>assert.equal(parseCookies("a=1; maybridge_session=abc").maybridge_session,"abc"));
