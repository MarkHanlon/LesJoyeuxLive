import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import webpush from 'web-push';
import { getDb } from './_db';
import { sendPushToAdmins, sendPushToAll } from './push/_send';

const scryptAsync = promisify(scrypt);
const VALID_SLOTS = ['morning', 'lunchtime', 'afternoon', 'dinnertime', 'evening'];
const VALID_ROLES = ['guest', 'staff', 'admin'];
const VALID_DRINKS = new Set([
  'pastis', 'red_wine', 'white_wine', 'rose', 'gt',
  'rum_coke', 'vodka_coke', 'gin_orange', 'cuba_libre', 'skinny_bitch',
  'beer', 'sparkling', 'oj', 'lemonade', 'cola', 'later',
  // kept for backward-compat display of existing records
  'kir', 'kir_royale', 'cremant', 'lillet', 'suze',
]);
const VALID_VISIT_STATUS = new Set(['coming', 'not_coming', 'undecided']);

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
  const rawUrl = (req.url ?? '').split('?')[0];
  const segments = rawUrl.replace(/^\/api\//, '').replace(/^\//, '').split('/').filter(Boolean);
  const [seg0, seg1, seg2] = segments;
  const method = req.method ?? 'GET';

  console.log(JSON.stringify({
    _api: true, method,
    path: `/${segments.join('/')}`,
    headers: {
      'x-user-id': req.headers['x-user-id'] ? '(set)' : '(missing)',
      'x-admin-id': req.headers['x-admin-id'] ? '(set)' : '(missing)',
    },
  }));

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
        const MAX_ATTEMPTS = 5;
        const LOCKOUT_SECONDS = 15 * 60;
        // Lockout check — degrades gracefully if the columns don't exist yet (pre-migration).
        try {
          const [lock] = await db`SELECT pin_locked_until AS "lockedUntil" FROM users WHERE id = ${u.id}`;
          if (lock?.lockedUntil && new Date(lock.lockedUntil).getTime() > Date.now())
            return res.status(429).json({ error: 'Too many attempts. Try again later.' });
        } catch { /* lockout columns not migrated yet — skip */ }

        if (!u.pin_hash || !(await verifyPin(pin, u.pin_hash))) {
          // Increment failed attempts; lock the account once the threshold is reached.
          await db`
            UPDATE users
            SET failed_pin_attempts = failed_pin_attempts + 1,
                pin_locked_until = CASE WHEN failed_pin_attempts + 1 >= ${MAX_ATTEMPTS}
                                        THEN NOW() + make_interval(secs => ${LOCKOUT_SECONDS})
                                        ELSE pin_locked_until END
            WHERE id = ${u.id}
          `.catch(() => {});
          return res.status(401).json({ error: 'Wrong PIN for this name' });
        }
        await db`UPDATE users SET failed_pin_attempts = 0, pin_locked_until = NULL WHERE id = ${u.id}`.catch(() => {});
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
      const [caller] = await db`SELECT id FROM users WHERE id = ${userId} AND status = 'approved'`;
      if (!caller) return res.status(403).json({ error: 'Forbidden' });
      const members = await db`
        SELECT
          u.id,
          u.name,
          u.is_admin                        AS "isAdmin",
          u.avatar                          AS "avatar",
          COALESCE(u.role, 'guest')         AS "role",
          COALESCE(u.is_test, false)        AS "isTest",
          v.arrive_date::text               AS "arriveDate",
          v.arrive_slot                     AS "arriveSlot",
          v.depart_date::text               AS "departDate",
          v.depart_slot                     AS "departSlot",
          v.save_lunch                      AS "saveLunch",
          v.save_dinner                     AS "saveDinner",
          COALESCE(
            CASE WHEN v.tonight_date = CURRENT_DATE THEN v.tonight_aperitif ELSE NULL END,
            v.aperitif
          )                                 AS "aperitif",
          v.pickup_needed                   AS "pickupNeeded",
          v.pickup_time                     AS "pickupTime",
          v.pickup_from                     AS "pickupFrom",
          v.dropoff_needed                  AS "dropoffNeeded",
          v.dropoff_time                    AS "dropoffTime",
          v.dropoff_to                      AS "dropoffTo",
          COALESCE(v.status, 'coming')      AS "visitStatus",
          v.updated_at                      AS "visitUpdatedAt"
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
      const callerId = req.headers['x-user-id'] as string | undefined;
      if (!callerId || callerId !== id) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
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
            CASE WHEN tonight_date = CURRENT_DATE THEN tonight_aperitif ELSE NULL END AS tonight_aperitif,
            pickup_needed,
            pickup_time,
            pickup_from,
            dropoff_needed,
            dropoff_time,
            dropoff_to,
            COALESCE(status, 'coming') AS status
          FROM visits WHERE user_id = ${id} LIMIT 1
        `;
        if (rows.length === 0) return res.status(404).json({ visit: null });
        return res.status(200).json(rows[0]);
      }
      if (method === 'POST') {
        const { arriveDate, arriveSlot, saveLunch, saveDinner, departDate, departSlot, aperitif,
                pickupNeeded, pickupTime, pickupFrom, dropoffNeeded, dropoffTime, dropoffTo,
                status } = req.body ?? {};
        const statusVal = typeof status === 'string' && VALID_VISIT_STATUS.has(status) ? status : 'coming';
        const coming = statusVal === 'coming';
        // For a "coming" visit, dates are required and validated as before.
        // Otherwise (not_coming / undecided) the visit carries no dates — everything is nulled.
        if (coming) {
          if (!arriveDate || !departDate) return res.status(400).json({ error: 'Dates required' });
          if (!VALID_SLOTS.includes(arriveSlot) || !VALID_SLOTS.includes(departSlot))
            return res.status(400).json({ error: 'Invalid time slot' });
          if (departDate < arriveDate) return res.status(400).json({ error: 'Departure must be on or after arrival' });
        }
        const arriveDateVal  = coming ? arriveDate : null;
        const arriveSlotVal  = coming ? arriveSlot : null;
        const departDateVal  = coming ? departDate : null;
        const departSlotVal  = coming ? departSlot : null;
        const saveLunchVal   = coming ? !!saveLunch : false;
        const saveDinnerVal  = coming ? !!saveDinner : false;
        const aperitifVal    = coming && typeof aperitif === 'string' && VALID_DRINKS.has(aperitif) ? aperitif : null;
        const pickupNeededVal  = coming ? !!pickupNeeded : false;
        const dropoffNeededVal = coming ? !!dropoffNeeded : false;
        const pickupTimeVal  = coming && typeof pickupTime  === 'string' && /^\d{2}:\d{2}$/.test(pickupTime)  ? pickupTime  : null;
        const pickupFromVal  = coming && typeof pickupFrom  === 'string' && pickupFrom.length  <= 200 ? pickupFrom.trim()  || null : null;
        const dropoffTimeVal = coming && typeof dropoffTime === 'string' && /^\d{2}:\d{2}$/.test(dropoffTime) ? dropoffTime : null;
        const dropoffToVal   = coming && typeof dropoffTo   === 'string' && dropoffTo.length   <= 200 ? dropoffTo.trim()   || null : null;
        const [row] = await db`
          INSERT INTO visits (user_id, arrive_date, arrive_slot, save_lunch, save_dinner, depart_date, depart_slot, aperitif,
                              pickup_needed, pickup_time, pickup_from, dropoff_needed, dropoff_time, dropoff_to, status)
          VALUES (${id}, ${arriveDateVal}, ${arriveSlotVal}, ${saveLunchVal}, ${saveDinnerVal}, ${departDateVal}, ${departSlotVal}, ${aperitifVal},
                  ${pickupNeededVal}, ${pickupTimeVal}, ${pickupFromVal}, ${dropoffNeededVal}, ${dropoffTimeVal}, ${dropoffToVal}, ${statusVal})
          ON CONFLICT (user_id) DO UPDATE SET
            arrive_date    = EXCLUDED.arrive_date,
            arrive_slot    = EXCLUDED.arrive_slot,
            save_lunch     = EXCLUDED.save_lunch,
            save_dinner    = EXCLUDED.save_dinner,
            depart_date    = EXCLUDED.depart_date,
            depart_slot    = EXCLUDED.depart_slot,
            aperitif       = EXCLUDED.aperitif,
            pickup_needed  = EXCLUDED.pickup_needed,
            pickup_time    = EXCLUDED.pickup_time,
            pickup_from    = EXCLUDED.pickup_from,
            dropoff_needed = EXCLUDED.dropoff_needed,
            dropoff_time   = EXCLUDED.dropoff_time,
            dropoff_to     = EXCLUDED.dropoff_to,
            status         = EXCLUDED.status,
            updated_at     = NOW()
          RETURNING arrive_date::text, arrive_slot, save_lunch, save_dinner, depart_date::text, depart_slot, aperitif,
                    pickup_needed, pickup_time, pickup_from, dropoff_needed, dropoff_time, dropoff_to, status
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
      if (typeof aperitif !== 'string' || !VALID_DRINKS.has(aperitif))
        return res.status(400).json({ error: 'aperitif required' });
      const db = getDb();
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

    // GET /api/status/:id  — caller must present their own id; used by AuthContext on startup
    if (seg0 === 'status' && seg1 && !seg2) {
      if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const requesterId = req.headers['x-user-id'] as string | undefined;
      if (!requesterId || requesterId !== seg1) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [user] = await db`
        SELECT id, name, status, is_admin AS "isAdmin", avatar
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
      const callerId = req.headers['x-user-id'] as string | undefined;
      const { userId, subscription } = req.body ?? {};
      if (!callerId || callerId !== userId) return res.status(401).json({ error: 'Unauthorized' });
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
      const testAdminId = req.headers['x-admin-id'] as string | undefined;
      if (!testAdminId) return res.status(401).json({ error: 'Unauthorized' });
      const testDb = getDb();
      const [testAdmin] = await testDb`SELECT id FROM users WHERE id = ${testAdminId} AND is_admin = true`;
      if (!testAdmin) return res.status(403).json({ error: 'Forbidden' });
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

    // GET /api/push/bell  — last bell info (cooldown check)
    // POST /api/push/bell — ring the bell (any approved user, 5-min cooldown)
    if (seg0 === 'push' && seg1 === 'bell' && !seg2) {
      const bellUserId = req.headers['x-user-id'] as string | undefined;
      if (!bellUserId) return res.status(401).json({ error: 'Unauthorized' });
      const bellDb = getDb();
      const [bellCaller] = await bellDb`SELECT id FROM users WHERE id = ${bellUserId} AND status = 'approved'`;
      if (!bellCaller) return res.status(403).json({ error: 'Forbidden' });

      await bellDb`
        CREATE TABLE IF NOT EXISTS bells (
          id       SERIAL      PRIMARY KEY,
          sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sent_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
          title    TEXT        NOT NULL,
          body     TEXT        NOT NULL
        )
      `;

      if (method === 'GET') {
        const [last] = await bellDb`SELECT sent_at, title, body FROM bells ORDER BY sent_at DESC LIMIT 1`;
        return res.status(200).json({ lastSentAt: last?.sent_at ?? null, title: last?.title ?? null });
      }

      if (method === 'POST') {
        const COOLDOWN_MS = 5 * 60 * 1000;
        const [last] = await bellDb`SELECT sent_at FROM bells ORDER BY sent_at DESC LIMIT 1`;
        if (last) {
          const elapsed = Date.now() - new Date(last.sent_at).getTime();
          if (elapsed < COOLDOWN_MS) {
            const availableAt = new Date(new Date(last.sent_at).getTime() + COOLDOWN_MS);
            return res.status(429).json({ error: 'cooldown', lastSentAt: last.sent_at, availableAt: availableAt.toISOString() });
          }
        }
        const { title, body } = req.body ?? {};
        if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title required' });
        const titleVal = title.slice(0, 100);
        const bodyVal  = (typeof body === 'string' ? body : '').slice(0, 200);
        await sendPushToAll(bellDb, { title: titleVal, body: bodyVal, url: '/' });
        const [bell] = await bellDb`INSERT INTO bells (sent_by, title, body) VALUES (${bellUserId}, ${titleVal}, ${bodyVal}) RETURNING sent_at`;
        return res.status(200).json({ ok: true, sentAt: bell.sent_at });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // GET /api/events  — list events in a date range (any approved user)
    // POST /api/events — create an event (admin only)
    if (seg0 === 'events' && !seg1) {
      if (method === 'GET') {
        const userId = req.headers['x-user-id'] as string | undefined;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        const db = getDb();
        const [caller] = await db`SELECT id FROM users WHERE id = ${userId} AND status = 'approved'`;
        if (!caller) return res.status(403).json({ error: 'Forbidden' });
        await db`
          CREATE TABLE IF NOT EXISTS events (
            id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            event_date DATE        NOT NULL,
            title      TEXT        NOT NULL,
            event_time TEXT,
            created_by UUID        REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;
        const { from, to } = req.query as { from?: string; to?: string };
        if (!from || !to) return res.status(400).json({ error: 'from and to required' });
        const rows = await db`
          SELECT id, event_date::text AS "eventDate", title, event_time AS "eventTime", created_at AS "createdAt"
          FROM events
          WHERE event_date BETWEEN ${from}::date AND ${to}::date
          ORDER BY event_date, event_time NULLS LAST, created_at
        `;
        return res.json(rows);
      }
      if (method === 'POST') {
        const adminId = req.headers['x-admin-id'] as string | undefined;
        if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
        const db = getDb();
        const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
        if (!admin) return res.status(403).json({ error: 'Forbidden' });
        const { date, title, time } = req.body ?? {};
        if (!date || typeof title !== 'string' || !title.trim())
          return res.status(400).json({ error: 'date and title required' });
        const titleVal = title.trim().slice(0, 120);
        const timeVal  = typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : null;
        const [ev] = await db`
          INSERT INTO events (event_date, title, event_time, created_by)
          VALUES (${date}::date, ${titleVal}, ${timeVal}, ${adminId})
          RETURNING id, event_date::text AS "eventDate", title, event_time AS "eventTime", created_at AS "createdAt"
        `;
        return res.status(201).json(ev);
      }
      return res.status(405).end();
    }

    // DELETE /api/events/:id — delete an event (admin only)
    if (seg0 === 'events' && seg1 && !seg2) {
      if (method !== 'DELETE') return res.status(405).end();
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      await db`DELETE FROM events WHERE id = ${seg1}`;
      return res.status(200).json({ ok: true });
    }

    // POST|DELETE /api/admin/test-users
    if (seg0 === 'admin' && seg1 === 'test-users' && !seg2) {
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false`;

      if (method === 'DELETE') {
        const { count } = (await db`DELETE FROM users WHERE is_test = true RETURNING id`).reduce(
          (acc: { count: number }) => ({ count: acc.count + 1 }), { count: 0 }
        );
        return res.status(200).json({ ok: true, deleted: count });
      }

      if (method === 'POST') {
        // Pin hashes that will never be guessable (random salt:hash — test users never log in)
        const dummyHash = () => `${randomBytes(16).toString('hex')}:${randomBytes(64).toString('hex')}`;

        // addDays helper (date math without Date.now())
        const addD = (base: string, n: number) => {
          const d = new Date(base + 'T12:00:00Z');
          d.setUTCDate(d.getUTCDate() + n);
          return d.toISOString().slice(0, 10);
        };
        const today = (await db`SELECT CURRENT_DATE::text AS d`)[0].d as string;

        type Fixture = {
          name: string; arriveOffset: number; departOffset: number;
          arriveSlot: string; departSlot: string; drink: string; role: string;
          saveLunch?: boolean; saveDinner?: boolean;
          pickupNeeded?: boolean; pickupTime?: string; pickupFrom?: string;
          dropoffNeeded?: boolean; dropoffTime?: string; dropoffTo?: string;
        };
        const fixtures: Fixture[] = [
          // Currently here
          { name: 'Sophie Beaumont',   arriveOffset: -5, departOffset:  2, arriveSlot: 'morning',   departSlot: 'morning',   drink: 'rose',         role: 'guest' },
          { name: 'Pierre Lefebvre',   arriveOffset: -3, departOffset:  4, arriveSlot: 'afternoon',  departSlot: 'morning',   drink: 'pastis',       role: 'guest' },
          { name: 'Marie Rousseau',    arriveOffset: -2, departOffset:  5, arriveSlot: 'morning',    departSlot: 'afternoon', drink: 'white_wine',   role: 'staff' },
          { name: 'Jean-Luc Martin',   arriveOffset: -1, departOffset:  3, arriveSlot: 'lunchtime',  departSlot: 'morning',   drink: 'beer',         role: 'guest', saveLunch: true },
          { name: 'Isabelle Moreau',   arriveOffset:  0, departOffset:  6, arriveSlot: 'morning',    departSlot: 'morning',   drink: 'gt',           role: 'guest' },
          { name: 'François Dupont',   arriveOffset:  0, departOffset:  4, arriveSlot: 'afternoon',  departSlot: 'afternoon', drink: 'red_wine',     role: 'guest' },
          { name: 'Camille Bernard',   arriveOffset:  0, departOffset:  7, arriveSlot: 'dinnertime', departSlot: 'morning',   drink: 'rum_coke',     role: 'guest', saveDinner: true },
          { name: 'Olivier Petit',     arriveOffset: -4, departOffset:  1, arriveSlot: 'morning',    departSlot: 'morning',   drink: 'sparkling',    role: 'staff' },
          // Arriving soon
          { name: 'Émeline Fournier',  arriveOffset:  1, departOffset:  5, arriveSlot: 'morning',    departSlot: 'afternoon', drink: 'cola',         role: 'guest' },
          { name: 'Hugo Girard',       arriveOffset:  1, departOffset:  4, arriveSlot: 'afternoon',  departSlot: 'morning',   drink: 'vodka_coke',   role: 'guest' },
          { name: 'Lucie Bonnet',      arriveOffset:  2, departOffset:  6, arriveSlot: 'lunchtime',  departSlot: 'morning',   drink: 'lemonade',     role: 'guest', saveLunch: true },
          { name: 'Thomas Morel',      arriveOffset:  2, departOffset:  5, arriveSlot: 'morning',    departSlot: 'afternoon', drink: 'gin_orange',   role: 'guest' },
          { name: 'Élise Lambert',     arriveOffset:  3, departOffset:  8, arriveSlot: 'dinnertime', departSlot: 'morning',   drink: 'cuba_libre',   role: 'guest', saveDinner: true },
          { name: 'Nicolas Fontaine',  arriveOffset:  4, departOffset:  9, arriveSlot: 'evening',    departSlot: 'morning',   drink: 'skinny_bitch', role: 'guest', saveDinner: true, pickupNeeded: true,  pickupTime: '16:30',  pickupFrom: 'Carcassonne Airport' },
          { name: 'Audrey Leroy',      arriveOffset:  5, departOffset: 10, arriveSlot: 'morning',    departSlot: 'morning',   drink: 'oj',           role: 'guest' },
          // Further out
          { name: 'Baptiste Roux',     arriveOffset:  8, departOffset: 14, arriveSlot: 'afternoon',  departSlot: 'afternoon', drink: 'rose',         role: 'guest', dropoffNeeded: true, dropoffTime: '09:00', dropoffTo: 'Toulouse Airport' },
          { name: 'Margot Leclerc',    arriveOffset: 10, departOffset: 17, arriveSlot: 'morning',    departSlot: 'morning',   drink: 'pastis',       role: 'guest' },
          { name: 'Romain Mercier',    arriveOffset: 14, departOffset: 21, arriveSlot: 'afternoon',  departSlot: 'morning',   drink: 'red_wine',     role: 'guest' },
          // Already left
          { name: 'Sandrine Garnier',  arriveOffset: -8, departOffset: -1, arriveSlot: 'morning',    departSlot: 'afternoon', drink: 'white_wine',   role: 'guest' },
          { name: 'Christophe Faure',  arriveOffset:-10, departOffset: -2, arriveSlot: 'afternoon',  departSlot: 'morning',   drink: 'beer',         role: 'guest' },
        ];

        let created = 0;
        for (const f of fixtures) {
          const [newUser] = await db`
            INSERT INTO users (name, pin_hash, status, is_admin, role, is_test)
            VALUES (${f.name}, ${dummyHash()}, 'approved', false, ${f.role}, true)
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          if (!newUser) continue;
          const arriveDate = addD(today, f.arriveOffset);
          const departDate = addD(today, f.departOffset);
          await db`
            INSERT INTO visits (user_id, arrive_date, arrive_slot, save_lunch, save_dinner,
                                depart_date, depart_slot, aperitif,
                                pickup_needed, pickup_time, pickup_from,
                                dropoff_needed, dropoff_time, dropoff_to)
            VALUES (${newUser.id}, ${arriveDate}, ${f.arriveSlot}, ${!!f.saveLunch}, ${!!f.saveDinner},
                    ${departDate}, ${f.departSlot}, ${f.drink},
                    ${!!f.pickupNeeded},  ${f.pickupTime  ?? null}, ${f.pickupFrom  ?? null},
                    ${!!f.dropoffNeeded}, ${f.dropoffTime ?? null}, ${f.dropoffTo   ?? null})
          `;
          created++;
        }
        return res.status(200).json({ ok: true, created });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // POST /api/migrate
    if (seg0 === 'migrate' && !seg1) {
      if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const migrateAdminId = req.headers['x-admin-id'] as string | undefined;
      if (!migrateAdminId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [migrateAdmin] = await db`SELECT id FROM users WHERE id = ${migrateAdminId} AND is_admin = true`;
      if (!migrateAdmin) return res.status(403).json({ error: 'Forbidden' });
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
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS role    TEXT    NOT NULL DEFAULT 'guest'`;
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false`;
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_pin_attempts INT NOT NULL DEFAULT 0`;
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ`;
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
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS pickup_needed  BOOLEAN NOT NULL DEFAULT false`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS pickup_time    TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS pickup_from    TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS dropoff_needed BOOLEAN NOT NULL DEFAULT false`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS dropoff_time   TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS dropoff_to     TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'coming'`;
      // Allow status-only rows (not coming / undecided) with no dates.
      await db`ALTER TABLE visits ALTER COLUMN arrive_date DROP NOT NULL`;
      await db`ALTER TABLE visits ALTER COLUMN depart_date DROP NOT NULL`;
      await db`ALTER TABLE visits ALTER COLUMN arrive_slot DROP NOT NULL`;
      await db`ALTER TABLE visits ALTER COLUMN depart_slot DROP NOT NULL`;
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
      await db`
        CREATE TABLE IF NOT EXISTS events (
          id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          event_date DATE        NOT NULL,
          title      TEXT        NOT NULL,
          event_time TEXT,
          created_by UUID        REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await db`
        CREATE TABLE IF NOT EXISTS bells (
          id       SERIAL      PRIMARY KEY,
          sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sent_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
          title    TEXT        NOT NULL,
          body     TEXT        NOT NULL
        )
      `;
      return res.status(200).json({ ok: true, message: 'Database ready' });
    }

    // PATCH /api/user/:id — update avatar
    if (seg0 === 'user' && seg1 && !seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId || userId !== seg1) return res.status(401).json({ error: 'Unauthorized' });
      const { avatar } = req.body ?? {};
      const SAFE_IMAGE_PREFIXES = ['data:image/jpeg', 'data:image/png', 'data:image/webp'];
      if (typeof avatar !== 'string' || !SAFE_IMAGE_PREFIXES.some(p => avatar.startsWith(p)))
        return res.status(400).json({ error: 'Invalid avatar data' });
      if (avatar.length > 200_000)
        return res.status(400).json({ error: 'Image too large' });
      const db = getDb();
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`;
      await db`UPDATE users SET avatar = ${avatar} WHERE id = ${seg1}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err: any) {
    console.error(JSON.stringify({ _api: true, error: err.message, stack: err.stack, method, rawUrl: req.url, segments }));
    return res.status(500).json({ error: 'Internal server error' });
  }
}
