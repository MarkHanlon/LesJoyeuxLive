import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import webpush from 'web-push';
import { getDb } from './_db';
import { sendPushToAdmins, sendPushToAll } from './push/_send';

const scryptAsync = promisify(scrypt);
const VALID_SLOTS = ['morning', 'lunchtime', 'afternoon', 'dinnertime', 'evening'];
const VALID_ROLES = ['guest', 'staff', 'admin'];

async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scryptAsync(pin, salt, 64)) as Buffer;
  return `${salt}:${buf.toString('hex')}`;
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const hashBuf = Buffer.from(hash, 'hex');
  const derived = (await scryptAsync(pin, salt, 64)) as Buffer;
  return timingSafeEqual(hashBuf, derived);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Parse path using all available sources — Vercel can expose different things
  // depending on how the function is invoked (catch-all vs rewrite vs direct)
  let segments: string[] = [];

  // Source 1: req.url (full request path, e.g. /api/family/members)
  const rawUrl = (req.url ?? '').split('?')[0];
  if (rawUrl && rawUrl !== '/' && !rawUrl.includes('[...')) {
    const stripped = rawUrl.replace(/^\/api\//, '').replace(/^\//, '');
    const fromUrl = stripped.split('/').filter(Boolean);
    if (fromUrl.length > 0) segments = fromUrl;
  }

  // Source 2: req.query.path from the [...path] catch-all parameter
  if (segments.length === 0) {
    const qp = req.query.path;
    if (Array.isArray(qp) && qp.some(Boolean)) {
      segments = qp.filter(Boolean);
    } else if (typeof qp === 'string' && qp) {
      segments = qp.split('/').filter(Boolean);
    }
  }

  const [seg0, seg1, seg2] = segments;
  const method = req.method ?? 'GET';

  try {
    // POST /api/register
    if (seg0 === 'register' && !seg1) {
      if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { name, pin } = req.body ?? {};
      if (!name || typeof name !== 'string' || !name.trim())
        return res.status(400).json({ error: 'Name is required' });
      if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin))
        return res.status(400).json({ error: 'PIN must be 4 digits' });
      const db = getDb();
      const trimmedName = name.trim();
      const existing = await db`
        SELECT id, name, status, is_admin AS "isAdmin", pin_hash
        FROM users WHERE LOWER(name) = LOWER(${trimmedName})
        LIMIT 1
      `;
      if (existing.length > 0) {
        const u = existing[0];
        if (!u.pin_hash || !(await verifyPin(pin, u.pin_hash)))
          return res.status(401).json({ error: 'Wrong PIN for this name' });
        return res.status(200).json({ id: u.id, name: u.name, status: u.status, isAdmin: u.isAdmin });
      }
      const [{ count }] = await db`SELECT COUNT(*) AS count FROM users`;
      const isFirst = Number(count) === 0;
      const pinHash = await hashPin(pin);
      const [user] = await db`
        INSERT INTO users (name, pin_hash, status, is_admin)
        VALUES (${trimmedName}, ${pinHash}, ${isFirst ? 'approved' : 'pending'}, ${isFirst})
        RETURNING id, name, status, is_admin AS "isAdmin", created_at AS "createdAt"
      `;
      if (user.status === 'pending') {
        await sendPushToAdmins(db, {
          title: 'Someone is knocking 🚪',
          body: `${trimmedName} is waiting for your approval.`,
          url: '/(tabs)/admin',
        }).catch(() => {});
      }
      return res.status(201).json(user);
    }

    // GET /api/family/members
    if (seg0 === 'family' && seg1 === 'members' && !seg2) {
      if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS aperitif TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_aperitif TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_date DATE`;
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'guest'`;
      await db`UPDATE users SET role = 'admin' WHERE is_admin = true AND role = 'guest'`;
      const [caller] = await db`SELECT id FROM users WHERE id = ${userId} AND status = 'approved'`;
      if (!caller) return res.status(403).json({ error: 'Forbidden' });
      const members = await db`
        SELECT
          u.id,
          u.name,
          u.is_admin                        AS "isAdmin",
          COALESCE(u.role, 'guest')         AS "role",
          v.arrive_date::text               AS "arriveDate",
          v.arrive_slot                     AS "arriveSlot",
          v.depart_date::text               AS "departDate",
          v.depart_slot                     AS "departSlot",
          COALESCE(
            CASE WHEN v.tonight_date = CURRENT_DATE THEN v.tonight_aperitif ELSE NULL END,
            v.aperitif
          )                                 AS "aperitif"
        FROM  users u
        LEFT  JOIN visits v ON v.user_id = u.id
        WHERE u.status = 'approved'
        ORDER BY u.name ASC
      `;
      return res.status(200).json(members);
    }

    // GET|POST /api/visit/:id
    if (seg0 === 'visit' && seg1 && !seg2) {
      const id = seg1;
      const db = getDb();
      await db`
        CREATE TABLE IF NOT EXISTS visits (
          id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          arrive_date DATE        NOT NULL,
          arrive_slot TEXT        NOT NULL,
          save_lunch  BOOLEAN     NOT NULL DEFAULT false,
          save_dinner BOOLEAN     NOT NULL DEFAULT false,
          depart_date DATE        NOT NULL,
          depart_slot TEXT        NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id)
        )
      `;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS aperitif TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_aperitif TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_date DATE`;
      if (method === 'GET') {
        const rows = await db`
          SELECT
            arrive_date::text,
            arrive_slot,
            save_lunch,
            save_dinner,
            depart_date::text,
            depart_slot,
            aperitif,
            CASE WHEN tonight_date = CURRENT_DATE THEN tonight_aperitif ELSE NULL END AS tonight_aperitif
          FROM visits WHERE user_id = ${id} LIMIT 1
        `;
        if (rows.length === 0) return res.status(404).json({ visit: null });
        return res.status(200).json(rows[0]);
      }
      if (method === 'POST') {
        const { arriveDate, arriveSlot, saveLunch, saveDinner, departDate, departSlot, aperitif } = req.body ?? {};
        if (!arriveDate || !departDate) return res.status(400).json({ error: 'Dates required' });
        if (!VALID_SLOTS.includes(arriveSlot) || !VALID_SLOTS.includes(departSlot))
          return res.status(400).json({ error: 'Invalid time slot' });
        if (departDate < arriveDate) return res.status(400).json({ error: 'Departure must be on or after arrival' });
        const aperitifVal = typeof aperitif === 'string' && aperitif ? aperitif : null;
        const [row] = await db`
          INSERT INTO visits (user_id, arrive_date, arrive_slot, save_lunch, save_dinner, depart_date, depart_slot, aperitif)
          VALUES (${id}, ${arriveDate}, ${arriveSlot}, ${!!saveLunch}, ${!!saveDinner}, ${departDate}, ${departSlot}, ${aperitifVal})
          ON CONFLICT (user_id) DO UPDATE SET
            arrive_date = EXCLUDED.arrive_date,
            arrive_slot = EXCLUDED.arrive_slot,
            save_lunch  = EXCLUDED.save_lunch,
            save_dinner = EXCLUDED.save_dinner,
            depart_date = EXCLUDED.depart_date,
            depart_slot = EXCLUDED.depart_slot,
            aperitif    = EXCLUDED.aperitif,
            updated_at  = NOW()
          RETURNING arrive_date::text, arrive_slot, save_lunch, save_dinner, depart_date::text, depart_slot, aperitif
        `;
        return res.status(200).json(row);
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // PATCH /api/visit/drink/:id
    if (seg0 === 'visit' && seg1 === 'drink' && seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId || userId !== seg2) return res.status(401).json({ error: 'Unauthorized' });
      const { aperitif, tonight } = req.body ?? {};
      if (typeof aperitif !== 'string' || !aperitif)
        return res.status(400).json({ error: 'aperitif required' });
      const db = getDb();
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_aperitif TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_date DATE`;
      if (tonight) {
        await db`
          UPDATE visits
          SET tonight_aperitif = ${aperitif},
              tonight_date     = CURRENT_DATE
          WHERE user_id = ${seg2}
        `;
      } else {
        await db`
          UPDATE visits
          SET aperitif         = ${aperitif},
              tonight_aperitif = NULL,
              tonight_date     = NULL
          WHERE user_id = ${seg2}
        `;
      }
      return res.status(200).json({ ok: true });
    }

    // GET /api/status/:id
    if (seg0 === 'status' && seg1 && !seg2) {
      if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const db = getDb();
      const [user] = await db`
        SELECT id, name, status, is_admin AS "isAdmin"
        FROM   users
        WHERE  id = ${seg1}
      `;
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json(user);
    }

    // GET /api/admin/users
    if (seg0 === 'admin' && seg1 === 'users' && !seg2) {
      if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      const users = await db`
        SELECT id, name, status, is_admin AS "isAdmin", created_at AS "createdAt"
        FROM  users
        WHERE status = 'pending' AND is_admin = false
        ORDER BY created_at ASC
      `;
      return res.status(200).json(users);
    }

    // POST /api/admin/approve/:id
    if (seg0 === 'admin' && seg1 === 'approve' && seg2) {
      if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      const [user] = await db`
        UPDATE users
        SET    status = 'approved'
        WHERE  id = ${seg2}
        RETURNING id, name, status, is_admin AS "isAdmin"
      `;
      if (!user) return res.status(404).json({ error: 'User not found' });
      await sendPushToAll(db, {
        title: '👋 New family member!',
        body: `${user.name} has just joined Les Joyeux Live.`,
      });
      return res.status(200).json(user);
    }

    // DELETE /api/admin/remove/:id
    if (seg0 === 'admin' && seg1 === 'remove' && seg2) {
      if (method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      if (seg2 === adminId) return res.status(400).json({ error: 'Cannot remove yourself' });
      const [target] = await db`SELECT id, is_admin FROM users WHERE id = ${seg2}`;
      if (!target) return res.status(404).json({ error: 'User not found' });
      if (target.is_admin) return res.status(400).json({ error: 'Cannot remove another admin' });
      await db`DELETE FROM users WHERE id = ${seg2}`;
      return res.status(200).json({ ok: true });
    }

    // PATCH /api/admin/role/:id
    if (seg0 === 'admin' && seg1 === 'role' && seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      if (seg2 === adminId) return res.status(400).json({ error: 'Cannot change your own role' });
      const { role } = req.body ?? {};
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      await db`
        UPDATE users
        SET role     = ${role},
            is_admin = ${role === 'admin'}
        WHERE id = ${seg2}
      `;
      return res.status(200).json({ ok: true });
    }

    // POST /api/push/subscribe
    if (seg0 === 'push' && seg1 === 'subscribe' && !seg2) {
      if (method !== 'POST') return res.status(405).end();
      const { userId, subscription } = req.body ?? {};
      if (
        !userId || typeof userId !== 'string' ||
        !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth
      ) {
        return res.status(400).json({ error: 'Invalid subscription data' });
      }
      const db = getDb();
      const user = await db`SELECT id FROM users WHERE id = ${userId} LIMIT 1`;
      if (user.length === 0) return res.status(404).json({ error: 'User not found' });
      await db`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
        VALUES (${userId}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
        ON CONFLICT (endpoint) DO UPDATE SET
          user_id    = EXCLUDED.user_id,
          p256dh     = EXCLUDED.p256dh,
          auth       = EXCLUDED.auth,
          updated_at = NOW()
      `;
      return res.status(201).json({ ok: true });
    }

    // GET /api/push/vapid-key
    if (seg0 === 'push' && seg1 === 'vapid-key' && !seg2) {
      if (method !== 'GET') return res.status(405).end();
      const key = process.env.VAPID_PUBLIC_KEY;
      if (!key) return res.status(503).json({ error: 'Push notifications not configured' });
      return res.json({ publicKey: key });
    }

    // POST /api/push/test
    if (seg0 === 'push' && seg1 === 'test' && !seg2) {
      if (method !== 'POST') return res.status(405).end();
      const subject = process.env.VAPID_SUBJECT;
      const publicKey = process.env.VAPID_PUBLIC_KEY;
      const privateKey = process.env.VAPID_PRIVATE_KEY;
      if (!subject || !publicKey || !privateKey) {
        return res.status(500).json({ error: 'VAPID env vars missing', subject: !!subject, publicKey: !!publicKey, privateKey: !!privateKey });
      }
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
      } catch (e: any) {
        return res.status(500).json({ error: 'VAPID init failed', detail: e.message });
      }
      const db = getDb();
      const subs = await db`
        SELECT ps.endpoint, ps.p256dh, ps.auth, u.name
        FROM push_subscriptions ps
        JOIN users u ON u.id = ps.user_id
        WHERE u.is_admin = true
      `;
      if (subs.length === 0) return res.status(404).json({ error: 'No admin subscriptions found' });
      const results = await Promise.allSettled(
        subs.map(async (sub) => {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: 'Test 🔔', body: 'Push is working!', url: '/' })
          );
          return { admin: sub.name, endpoint: sub.endpoint.slice(0, 40) + '...' };
        })
      );
      return res.json({
        results: results.map(r =>
          r.status === 'fulfilled'
            ? { ok: true, ...r.value }
            : { ok: false, error: (r as PromiseRejectedResult).reason?.message }
        ),
      });
    }

    // POST /api/migrate
    if (seg0 === 'migrate' && !seg1) {
      if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const db = getDb();
      await db`
        CREATE TABLE IF NOT EXISTS users (
          id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          name       TEXT        NOT NULL,
          status     TEXT        NOT NULL DEFAULT 'pending',
          is_admin   BOOLEAN     NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      const [{ column_exists }] = await db`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'pin_hash'
        ) AS column_exists
      `;
      if (!column_exists) {
        await db`ALTER TABLE users ADD COLUMN pin_hash TEXT`;
        await db`TRUNCATE users`;
      }
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'guest'`;
      await db`UPDATE users SET role = 'admin' WHERE is_admin = true AND role = 'guest'`;
      await db`
        CREATE TABLE IF NOT EXISTS visits (
          id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          arrive_date DATE        NOT NULL,
          arrive_slot TEXT        NOT NULL,
          save_lunch  BOOLEAN     NOT NULL DEFAULT false,
          save_dinner BOOLEAN     NOT NULL DEFAULT false,
          depart_date DATE        NOT NULL,
          depart_slot TEXT        NOT NULL,
          aperitif    TEXT,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id)
        )
      `;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS aperitif TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_aperitif TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_date DATE`;
      await db`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint   TEXT        NOT NULL UNIQUE,
          p256dh     TEXT        NOT NULL,
          auth       TEXT        NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      if (req.query.reset === 'true') {
        await db`TRUNCATE push_subscriptions, visits, users RESTART IDENTITY CASCADE`;
      }
      return res.status(200).json({ ok: true, message: 'Database ready' });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
