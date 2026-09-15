import 'dotenv/config';
import {db,transaction} from '../lib/db.js';
const email=String(process.argv[2]||'').trim().toLowerCase();
if(!/^\S+@\S+\.\S+$/.test(email))throw new Error('Supply the exact email of the existing owner account: npm run owner -- owner@example.com');
try {
  await transaction(async c=>{
    const {rows}=await c.query('SELECT id,role FROM users WHERE lower(email)=$1 AND disabled_at IS NULL FOR UPDATE',[email]);
    if(rows.length!==1)throw new Error('Create the owner account through the portal first. No account was changed.');
    if(rows[0].role==='provider')throw new Error('Use a separate owner account; this account has a provider profile.');
    await c.query("UPDATE users SET role='admin' WHERE id=$1",[rows[0].id]);
    await c.query('DELETE FROM sessions WHERE user_id=$1',[rows[0].id]);
  });
  console.log('Owner access enabled. Sign in again to open the review queue.');
} finally {await db().end();}
