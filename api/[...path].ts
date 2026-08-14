import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import webpush from 'web-push';
import { getDb } from './_db';
import { sendPushToAdmins, sendPushToAll, sendPushToPresent } from './push/_send';
import { HOT_DRINK_KEYS } from '../constants/drinks';
import { VALID_ROOM_KEYS } from '../constants/rooms';

const scryptAsync = promisify(scrypt);
const VALID_SLOTS = ['morning', 'lunchtime', 'afternoon', 'dinnertime', 'evening'];
const VALID_ROLES = ['guest', 'staff', 'admin'];
const VALID_DRINKS = new Set([
  'pastis', 'red_wine', 'white_wine', 'rose', 'gt',
  'rum_coke', 'rum_coke_zero', 'vodka_coke', 'vodka_coke_zero', 'gin_orange',
  'cuba_libre', 'cuba_libre_zero', 'skinny_bitch',
  'beer', 'sparkling', 'oj', 'mango', 'lemonade', 'cola', 'coke_zero', 'later',
  // kept for backward-compat display of existing records
  'kir', 'kir_royale', 'cremant', 'lillet', 'suze',
]);
const VALID_VISIT_STATUS = new Set(['coming', 'not_coming', 'undecided']);

// A "site owner" can run migrations and manage test users — a level above admin.
// Resolves resiliently so nobody is ever locked out: if the is_owner column
// isn't there yet (pre-migration) or no owner has been set, the earliest-created
// user is treated as the bootstrap owner. Once any real owner exists, only a
// stored is_owner=true grants it.
async function callerIsOwner(db: any, userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const [u] = await db`SELECT COALESCE(is_owner, false) AS "isOwner" FROM users WHERE id = ${userId}`;
    if (!u) return false;
    if (u.isOwner) return true;
    const [{ n }] = await db`SELECT COUNT(*)::int AS n FROM users WHERE is_owner = true`;
    if (n > 0) return false;
    const [first] = await db`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`;
    return !!first && first.id === userId;
  } catch {
    // is_owner column doesn't exist yet — earliest user bootstraps ownership.
    const [first] = await db`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`;
    return !!first && first.id === userId;
  }
}

// Staff are "always here" workers with no visit to plan — they may not edit
// visit/drink/skip data. Self-service write endpoints call this to reject them.
async function callerIsStaff(db: any, userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const [u] = await db`SELECT role FROM users WHERE id = ${userId}`;
    return u?.role === 'staff';
  } catch { return false; }
}

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
        SELECT id, name, status, is_admin AS "isAdmin", COALESCE(role, 'guest') AS role, pin_hash
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
        return res.status(200).json({ id: u.id, name: u.name, status: u.status, isAdmin: u.isAdmin, role: u.role, isOwner: await callerIsOwner(db, u.id) });
      }
      const [{ count }] = await db`SELECT COUNT(*) AS count FROM users`;
      const isFirst = Number(count) === 0;
      const pinHash = await hashPin(pin);
      const [user] = await db`
        INSERT INTO users (name, pin_hash, status, is_admin)
        VALUES (${trimmedName}, ${pinHash}, ${isFirst ? 'approved' : 'pending'}, ${isFirst})
        RETURNING id, name, status, is_admin AS "isAdmin", COALESCE(role, 'guest') AS role, created_at AS "createdAt"
      `;
      if (user.status === 'pending') {
        await sendPushToAdmins(db, {
          title: 'Someone is knocking 🚪',
          body: `${trimmedName} is waiting for your approval.`,
          url: '/(tabs)/admin',
        }).catch(() => {});
      }
      return res.status(201).json({ ...user, isOwner: await callerIsOwner(db, user.id) });
    }

    // GET /api/family/members
    if (seg0 === 'family' && seg1 === 'members' && !seg2) {
      if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [caller] = await db`SELECT id, is_admin AS "isAdmin" FROM users WHERE id = ${userId} AND status = 'approved'`;
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
          v.room                            AS "room",
          v.updated_at                      AS "visitUpdatedAt"
        FROM  users u
        LEFT  JOIN visits v ON v.user_id = u.id
        WHERE u.status = 'approved'
        ORDER BY u.name ASC
      `;
      // Attach date-ranged room allocations per member. Resilient to the table not
      // existing pre-migration (falls back to [] so the app keeps working).
      let allocByUser = new Map<string, any[]>();
      try {
        const allocRows = await db`
          SELECT user_id AS "userId",
                 json_agg(json_build_object(
                   'id', id, 'room', room,
                   'start', start_date::text, 'end', end_date::text
                 ) ORDER BY start_date) AS allocations
          FROM room_allocations
          GROUP BY user_id
        `;
        allocByUser = new Map(allocRows.map((r: any) => [r.userId, r.allocations]));
      } catch { /* room_allocations not migrated yet */ }
      const withAlloc = members.map((m: any) => ({ ...m, allocations: allocByUser.get(m.id) ?? [] }));
      // Attach today's per-day meal/aperitif skips. Guarded so a pre-migration DB
      // (columns absent) still works — every flag just defaults to false.
      let skipByUser = new Map<string, any>();
      try {
        const skipRows = await db`
          SELECT user_id AS "userId",
                 (skip_lunch_date    = CURRENT_DATE) AS "skipLunchToday",
                 (skip_dinner_date   = CURRENT_DATE) AS "skipDinnerToday",
                 (skip_aperitif_date = CURRENT_DATE) AS "skipAperitifToday",
                 (CASE WHEN hotdrink_date = CURRENT_DATE THEN lunch_drink  ELSE NULL END) AS "lunchDrink",
                 (CASE WHEN hotdrink_date = CURRENT_DATE THEN dinner_drink ELSE NULL END) AS "dinnerDrink",
                 cheese_notes AS "cheeseNotes"
          FROM visits
        `;
        skipByUser = new Map(skipRows.map((r: any) => [r.userId, r]));
      } catch { /* skip_* / hotdrink / cheese columns not migrated yet */ }
      const withSkips = withAlloc.map((m: any) => {
        const s = skipByUser.get(m.id);
        return {
          ...m,
          skipLunchToday: !!s?.skipLunchToday,
          skipDinnerToday: !!s?.skipDinnerToday,
          skipAperitifToday: !!s?.skipAperitifToday,
          lunchDrink: s?.lunchDrink ?? null,
          dinnerDrink: s?.dinnerDrink ?? null,
          cheeseNotes: s?.cheeseNotes ?? null,
        };
      });
      // Admins-only: mark who has push notifications enabled (≥1 subscription), so
      // Manage mode can show a 🔔/🔕 indicator. Kept off the payload for non-admins.
      let finalMembers = withSkips;
      if (caller.isAdmin) {
        let pushSet = new Set<string>();
        try {
          const rows = await db`SELECT DISTINCT user_id AS "userId" FROM push_subscriptions`;
          pushSet = new Set(rows.map((r: any) => r.userId));
        } catch { /* push_subscriptions absent — leave everyone as no-push */ }
        finalMembers = withSkips.map((m: any) => ({ ...m, hasPush: pushSet.has(m.id) }));
      }
      // Annotate who is a site owner — but only reveal it to owners (keeps owner
      // identity from leaking). Resilient to the column not existing pre-migration.
      if (await callerIsOwner(db, userId)) {
        let ownerIds = new Set<string>();
        try {
          const rows = await db`SELECT id FROM users WHERE is_owner = true`;
          ownerIds = new Set(rows.map((r: any) => r.id));
        } catch { /* is_owner not migrated yet */ }
        return res.status(200).json(finalMembers.map((m: any) => ({ ...m, isOwner: ownerIds.has(m.id) })));
      }
      return res.status(200).json(finalMembers);
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
            COALESCE(status, 'coming') AS status,
            room
          FROM visits WHERE user_id = ${id} LIMIT 1
        `;
        if (rows.length === 0) return res.status(404).json({ visit: null });
        let allocations: any[] = [];
        try {
          const [agg] = await db`
            SELECT json_agg(json_build_object(
                     'id', id, 'room', room,
                     'start', start_date::text, 'end', end_date::text
                   ) ORDER BY start_date) AS allocations
            FROM room_allocations WHERE user_id = ${id}
          `;
          allocations = agg?.allocations ?? [];
        } catch { /* room_allocations not migrated yet */ }
        let skips: any = { skipLunchToday: false, skipDinnerToday: false, skipAperitifToday: false,
                           lunchDrink: null, dinnerDrink: null, cheeseNotes: null };
        try {
          const [s] = await db`
            SELECT (skip_lunch_date    = CURRENT_DATE) AS "skipLunchToday",
                   (skip_dinner_date   = CURRENT_DATE) AS "skipDinnerToday",
                   (skip_aperitif_date = CURRENT_DATE) AS "skipAperitifToday",
                   (CASE WHEN hotdrink_date = CURRENT_DATE THEN lunch_drink  ELSE NULL END) AS "lunchDrink",
                   (CASE WHEN hotdrink_date = CURRENT_DATE THEN dinner_drink ELSE NULL END) AS "dinnerDrink",
                   cheese_notes AS "cheeseNotes"
            FROM visits WHERE user_id = ${id} LIMIT 1
          `;
          if (s) skips = {
            skipLunchToday: !!s.skipLunchToday,
            skipDinnerToday: !!s.skipDinnerToday,
            skipAperitifToday: !!s.skipAperitifToday,
            lunchDrink: s.lunchDrink ?? null,
            dinnerDrink: s.dinnerDrink ?? null,
            cheeseNotes: s.cheeseNotes ?? null,
          };
        } catch { /* skip_* / hotdrink / cheese columns not migrated yet */ }
        return res.status(200).json({ ...rows[0], allocations, ...skips });
      }
      if (method === 'POST') {
        if (await callerIsStaff(db, callerId)) return res.status(403).json({ error: 'Staff have no visit to edit' });
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
      if (await callerIsStaff(db, userId)) return res.status(403).json({ error: 'Staff have no apéritif to set' });
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

    // PATCH /api/visit/skip/:id — per-day opt-out of a meal/aperitif (self-only).
    // { meal: 'lunch'|'dinner'|'aperitif', skip: boolean }. Sets the matching skip
    // date to today (skip) or clears it. Today-scoped, so it resets next day.
    if (seg0 === 'visit' && seg1 === 'skip' && seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId || userId !== seg2) return res.status(401).json({ error: 'Unauthorized' });
      const { meal, skip } = req.body ?? {};
      if (meal !== 'lunch' && meal !== 'dinner' && meal !== 'aperitif')
        return res.status(400).json({ error: 'Invalid meal' });
      const on = !!skip;
      const db = getDb();
      if (await callerIsStaff(db, userId)) return res.status(403).json({ error: 'Staff have no meals to skip' });
      if (meal === 'lunch') {
        await db`UPDATE visits SET skip_lunch_date = CASE WHEN ${on} THEN CURRENT_DATE ELSE NULL END WHERE user_id = ${seg2}`;
      } else if (meal === 'dinner') {
        await db`UPDATE visits SET skip_dinner_date = CASE WHEN ${on} THEN CURRENT_DATE ELSE NULL END WHERE user_id = ${seg2}`;
      } else {
        await db`UPDATE visits SET skip_aperitif_date = CASE WHEN ${on} THEN CURRENT_DATE ELSE NULL END WHERE user_id = ${seg2}`;
      }
      return res.status(200).json({ ok: true, meal, skip: on });
    }

    // PATCH /api/visit/hotdrinks/:id — pick ONE after-lunch or after-dinner hot
    // drink for today (self-only). { meal: 'lunch'|'dinner', drink: <key>|null }.
    // Stamps hotdrink_date to today; picking on a stale day clears the other
    // sitting first, so both choices reset automatically each morning.
    if (seg0 === 'visit' && seg1 === 'hotdrinks' && seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId || userId !== seg2) return res.status(401).json({ error: 'Unauthorized' });
      const b = req.body ?? {};
      const meal = b.meal;
      if (meal !== 'lunch' && meal !== 'dinner') return res.status(400).json({ error: 'Invalid meal' });
      const drink = b.drink === null || b.drink === undefined ? null : String(b.drink);
      if (drink !== null && !HOT_DRINK_KEYS.includes(drink)) return res.status(400).json({ error: 'Invalid drink' });
      const db = getDb();
      if (await callerIsStaff(db, userId)) return res.status(403).json({ error: 'Staff have no drinks to order' });
      await db`
        UPDATE visits
        SET lunch_drink  = CASE WHEN ${meal} = 'lunch'  THEN ${drink}
                                WHEN hotdrink_date = CURRENT_DATE THEN lunch_drink  ELSE NULL END,
            dinner_drink = CASE WHEN ${meal} = 'dinner' THEN ${drink}
                                WHEN hotdrink_date = CURRENT_DATE THEN dinner_drink ELSE NULL END,
            hotdrink_date = CURRENT_DATE
        WHERE user_id = ${seg2}
      `;
      return res.status(200).json({ ok: true, meal, drink });
    }

    // PATCH /api/visit/cheese/:id — the caller's persistent note of cheeses they
    // enjoy (self-only, staff-blocked). Not date-scoped — it's a lasting memory.
    if (seg0 === 'visit' && seg1 === 'cheese' && seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId || userId !== seg2) return res.status(401).json({ error: 'Unauthorized' });
      const raw = (req.body ?? {}).notes;
      const notes = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 500) : null;
      const db = getDb();
      if (await callerIsStaff(db, userId)) return res.status(403).json({ error: 'Staff have no visit to edit' });
      await db`UPDATE visits SET cheese_notes = ${notes} WHERE user_id = ${seg2}`;
      return res.status(200).json({ ok: true, cheeseNotes: notes });
    }

    // GET /api/status/:id  — caller must present their own id; used by AuthContext on startup
    if (seg0 === 'status' && seg1 && !seg2) {
      if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const requesterId = req.headers['x-user-id'] as string | undefined;
      if (!requesterId || requesterId !== seg1) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [user] = await db`
        SELECT id, name, status, is_admin AS "isAdmin", COALESCE(role, 'guest') AS role, avatar
        FROM   users
        WHERE  id = ${seg1}
      `;
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json({ ...user, isOwner: await callerIsOwner(db, seg1) });
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
      const callerId = (req.headers['x-user-id'] ?? req.headers['x-admin-id']) as string | undefined;
      if (!callerId) return res.status(401).json({ error: 'Unauthorized' });
      if (seg2 === callerId) return res.status(400).json({ error: 'Cannot change your own role' });
      const { role } = req.body ?? {};
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      const db = getDb();
      const [caller] = await db`SELECT is_admin AS "isAdmin" FROM users WHERE id = ${callerId}`;
      if (!caller?.isAdmin) return res.status(403).json({ error: 'Forbidden' });
      // Granting or removing ADMIN requires site-owner authority — a regular admin
      // cannot create or demote admins (closes the self-promotion path).
      const [target] = await db`SELECT is_admin AS "isAdmin" FROM users WHERE id = ${seg2}`;
      const touchesAdmin = role === 'admin' || !!target?.isAdmin;
      if (touchesAdmin && !(await callerIsOwner(db, callerId)))
        return res.status(403).json({ error: 'Only the site owner can grant or remove admin' });
      await db`
        UPDATE users
        SET role     = ${role},
            is_admin = ${role === 'admin'}
        WHERE id = ${seg2}
      `;
      // Staff are "always here" with no visit — clear any stale guest data so it
      // doesn't linger in views. Guarded so a pre-migration DB can't break the change.
      if (role === 'staff') {
        try { await db`DELETE FROM room_allocations WHERE user_id = ${seg2}`; } catch {}
        try { await db`DELETE FROM visits WHERE user_id = ${seg2}`; } catch {}
      }
      return res.status(200).json({ ok: true });
    }

    // PATCH /api/admin/owner/:id — grant or revoke site-owner (owner only)
    if (seg0 === 'admin' && seg1 === 'owner' && seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const callerId = (req.headers['x-user-id'] ?? req.headers['x-admin-id']) as string | undefined;
      if (!callerId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      if (!(await callerIsOwner(db, callerId))) return res.status(403).json({ error: 'Site owner only' });
      const makeOwner = !!(req.body ?? {}).owner;
      if (makeOwner) {
        // Owners are admins too.
        await db`UPDATE users SET is_owner = true, is_admin = true, role = 'admin' WHERE id = ${seg2}`;
      } else {
        const [{ n }] = await db`SELECT COUNT(*)::int AS n FROM users WHERE is_owner = true`;
        const [tgt] = await db`SELECT COALESCE(is_owner, false) AS "isOwner" FROM users WHERE id = ${seg2}`;
        if (tgt?.isOwner && n <= 1) return res.status(400).json({ error: 'There must always be at least one site owner' });
        await db`UPDATE users SET is_owner = false WHERE id = ${seg2}`;
      }
      return res.status(200).json({ ok: true, owner: makeOwner });
    }

    // PATCH /api/admin/room/:id — DEPRECATED whole-stay shim kept for older clients.
    // Rewrites the person's allocations to a single segment spanning their whole stay
    // (or clears them). New clients use /api/admin/room-allocations instead.
    if (seg0 === 'admin' && seg1 === 'room' && seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const { room } = req.body ?? {};
      const roomVal = room == null || room === '' ? null
        : (typeof room === 'string' && VALID_ROOM_KEYS.has(room) ? room : undefined);
      if (roomVal === undefined) return res.status(400).json({ error: 'Invalid room' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      const [visit] = await db`SELECT arrive_date::text AS a, depart_date::text AS d FROM visits WHERE user_id = ${seg2}`;
      if (!visit) return res.status(409).json({ error: 'That person has no visit yet' });
      await db`DELETE FROM room_allocations WHERE user_id = ${seg2}`;
      if (roomVal && visit.a && visit.d) {
        await db`INSERT INTO room_allocations (user_id, room, start_date, end_date)
                 VALUES (${seg2}, ${roomVal}, ${visit.a}, ${visit.d})`;
      }
      await db`UPDATE visits SET room = ${roomVal}, updated_at = NOW() WHERE user_id = ${seg2}`;
      return res.status(200).json({ ok: true, room: roomVal });
    }

    // /api/admin/room-allocations — date-ranged room allocations (admin only).
    // POST creates; PATCH/:id edits; DELETE/:id removes. A person may hold several
    // non-overlapping segments; different people may overlap in one room (sharing).
    if (seg0 === 'admin' && seg1 === 'room-allocations') {
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

      // Validate a segment against the person's stay and their other segments.
      // Returns an error string, or null if OK. `excludeId` skips a row (for edits).
      const validateSegment = async (
        userId: string, room: string, start: string, end: string, excludeId: string | null,
      ): Promise<string | null> => {
        if (typeof room !== 'string' || !VALID_ROOM_KEYS.has(room)) return 'Invalid room';
        if (!DATE_RE.test(start) || !DATE_RE.test(end)) return 'Valid dates required';
        if (end < start) return 'End date must be on or after start date';
        const [visit] = await db`SELECT arrive_date::text AS a, depart_date::text AS d FROM visits WHERE user_id = ${userId}`;
        if (!visit || !visit.a || !visit.d) return 'That person has no dated visit';
        if (start < visit.a || end > visit.d) return 'Segment must be within the person\'s stay';
        // Neon's http tagged template can't compose SQL fragments, so branch instead.
        const others = excludeId
          ? await db`SELECT start_date::text AS start, end_date::text AS "end"
                     FROM room_allocations WHERE user_id = ${userId} AND id <> ${excludeId}`
          : await db`SELECT start_date::text AS start, end_date::text AS "end"
                     FROM room_allocations WHERE user_id = ${userId}`;
        // Strict (night-model) overlap: conflict only on a shared night, so a shared
        // boundary day (a same-day room move) is allowed; genuine overlaps are rejected.
        if (others.some((s: any) => start < s.end && s.start < end))
          return 'That overlaps another room for this person';
        return null;
      };

      if (!seg2) {
        if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { userId, room, start, end } = req.body ?? {};
        if (typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
        const err = await validateSegment(userId, room, start, end, null);
        if (err) return res.status(400).json({ error: err });
        const [row] = await db`
          INSERT INTO room_allocations (user_id, room, start_date, end_date)
          VALUES (${userId}, ${room}, ${start}, ${end})
          RETURNING id, room, start_date::text AS start, end_date::text AS "end"
        `;
        return res.status(200).json({ ok: true, allocation: row });
      }

      // seg2 = allocation id
      if (method === 'DELETE') {
        await db`DELETE FROM room_allocations WHERE id = ${seg2}`;
        return res.status(200).json({ ok: true });
      }
      if (method === 'PATCH') {
        const [cur] = await db`
          SELECT user_id AS "userId", room, start_date::text AS start, end_date::text AS "end"
          FROM room_allocations WHERE id = ${seg2}
        `;
        if (!cur) return res.status(404).json({ error: 'Allocation not found' });
        const { room, start, end } = req.body ?? {};
        const room2 = typeof room === 'string' ? room : cur.room;
        const start2 = typeof start === 'string' ? start : cur.start;
        const end2 = typeof end === 'string' ? end : cur.end;
        const err = await validateSegment(cur.userId, room2, start2, end2, seg2);
        if (err) return res.status(400).json({ error: err });
        const [row] = await db`
          UPDATE room_allocations
          SET room = ${room2}, start_date = ${start2}, end_date = ${end2}, updated_at = NOW()
          WHERE id = ${seg2}
          RETURNING id, room, start_date::text AS start, end_date::text AS "end"
        `;
        return res.status(200).json({ ok: true, allocation: row });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // PATCH /api/admin/visit/:id — admin fixes a member's arrival/departure dates
    if (seg0 === 'admin' && seg1 === 'visit' && seg2) {
      if (method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const { arriveDate, departDate } = req.body ?? {};
      const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (!isDate(arriveDate) || !isDate(departDate)) return res.status(400).json({ error: 'Valid dates required' });
      if (departDate < arriveDate) return res.status(400).json({ error: 'Departure must be on or after arrival' });
      const db = getDb();
      const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
      if (!admin) return res.status(403).json({ error: 'Forbidden' });
      const [target] = await db`SELECT id FROM users WHERE id = ${seg2}`;
      if (!target) return res.status(404).json({ error: 'User not found' });
      // Upsert: set the dates and mark the visit "coming". Slots are preserved when
      // present, otherwise defaulted (arrive afternoon / depart morning) so a
      // status-only or brand-new row still satisfies the slot columns.
      const [row] = await db`
        INSERT INTO visits (user_id, arrive_date, arrive_slot, depart_date, depart_slot, status)
        VALUES (${seg2}, ${arriveDate}, 'afternoon', ${departDate}, 'morning', 'coming')
        ON CONFLICT (user_id) DO UPDATE SET
          arrive_date = EXCLUDED.arrive_date,
          depart_date = EXCLUDED.depart_date,
          arrive_slot = COALESCE(visits.arrive_slot, 'afternoon'),
          depart_slot = COALESCE(visits.depart_slot, 'morning'),
          status      = 'coming',
          updated_at  = NOW()
        RETURNING arrive_date::text AS "arriveDate", depart_date::text AS "departDate",
                  arrive_slot AS "arriveSlot", depart_slot AS "departSlot", status
      `;
      return res.status(200).json({ ok: true, ...row });
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

    // POST /api/push/test-self — any user fires a test push to their own devices
    if (seg0 === 'push' && seg1 === 'test-self' && !seg2) {
      if (method !== 'POST') return res.status(405).end();
      const selfId = req.headers['x-user-id'] as string | undefined;
      if (!selfId) return res.status(401).json({ error: 'Unauthorized' });
      const subject = process.env.VAPID_SUBJECT;
      const publicKey = process.env.VAPID_PUBLIC_KEY;
      const privateKey = process.env.VAPID_PRIVATE_KEY;
      if (!subject || !publicKey || !privateKey) {
        return res.status(503).json({ error: 'Push not configured on server' });
      }
      webpush.setVapidDetails(subject, publicKey, privateKey);
      const db = getDb();
      const subs = await db`
        SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${selfId}
      `;
      if (subs.length === 0) return res.status(200).json({ sent: 0 });
      let sent = 0;
      await Promise.allSettled(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: 'Test 🔔', body: 'Your notifications are working!', url: '/' })
            );
            sent++;
          } catch (err: any) {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await db`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
            }
          }
        })
      );
      return res.status(200).json({ sent });
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
        await sendPushToPresent(bellDb, { title: titleVal, body: bodyVal, url: '/' });
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
        await db`
          CREATE TABLE IF NOT EXISTS event_rsvps (
            event_id   UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            user_id    UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
            status     TEXT        NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (event_id, user_id)
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
        // Attach RSVPs: who's going / declined per event, in the same date window.
        const rsvpRows = await db`
          SELECT r.event_id AS "eventId",
                 json_agg(json_build_object('id', u.id, 'name', u.name, 'status', r.status)
                          ORDER BY u.name) AS people
          FROM event_rsvps r
          JOIN users  u ON u.id = r.user_id
          JOIN events e ON e.id = r.event_id
          WHERE e.event_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY r.event_id
        `;
        const rsvpByEvent = new Map(rsvpRows.map((r: any) => [r.eventId, r.people ?? []]));
        const withRsvps = rows.map((ev: any) => {
          const people: any[] = rsvpByEvent.get(ev.id) ?? [];
          const going    = people.filter(p => p.status === 'going').map(p => ({ id: p.id, name: p.name }));
          const declined = people.filter(p => p.status === 'declined').map(p => ({ id: p.id, name: p.name }));
          const mine = people.find(p => p.id === userId);
          return { ...ev, going, declined, goingCount: going.length, declinedCount: declined.length, myStatus: mine?.status ?? null };
        });
        return res.json(withRsvps);
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
        // Let everyone know so they can RSVP. Best-effort — never block the response.
        try {
          const when = new Date(String(ev.eventDate) + 'T12:00:00')
            .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          await sendPushToAll(db, {
            title: `📅 New event: ${titleVal}`,
            body: `${when}${timeVal ? ` at ${timeVal}` : ''} — open the app to say if you’re going.`,
            url: '/',
          });
        } catch { /* push is best-effort */ }
        return res.status(201).json({ ...ev, going: [], declined: [], goingCount: 0, declinedCount: 0, myStatus: null });
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

    // PATCH /api/events/:id/rsvp — the caller says whether they're going.
    // { status: 'going' | 'declined' | null } (null clears their RSVP). Self-only,
    // staff-blocked (staff are always here and don't RSVP to family outings).
    if (seg0 === 'events' && seg1 && seg2 === 'rsvp') {
      if (method !== 'PATCH') return res.status(405).end();
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { status } = req.body ?? {};
      if (status !== 'going' && status !== 'declined' && status !== null)
        return res.status(400).json({ error: 'Invalid status' });
      const db = getDb();
      const [caller] = await db`SELECT id FROM users WHERE id = ${userId} AND status = 'approved'`;
      if (!caller) return res.status(403).json({ error: 'Forbidden' });
      if (await callerIsStaff(db, userId)) return res.status(403).json({ error: 'Staff are always here' });
      await db`
        CREATE TABLE IF NOT EXISTS event_rsvps (
          event_id   UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          user_id    UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
          status     TEXT        NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (event_id, user_id)
        )
      `;
      const [ev] = await db`SELECT id FROM events WHERE id = ${seg1}`;
      if (!ev) return res.status(404).json({ error: 'Event not found' });
      if (status === null) {
        await db`DELETE FROM event_rsvps WHERE event_id = ${seg1} AND user_id = ${userId}`;
      } else {
        await db`
          INSERT INTO event_rsvps (event_id, user_id, status)
          VALUES (${seg1}, ${userId}, ${status})
          ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
        `;
      }
      return res.status(200).json({ ok: true, status });
    }

    // POST|DELETE /api/admin/test-users
    if (seg0 === 'admin' && seg1 === 'test-users' && !seg2) {
      const tuCallerId = (req.headers['x-user-id'] ?? req.headers['x-admin-id']) as string | undefined;
      if (!tuCallerId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      if (!(await callerIsOwner(db, tuCallerId))) return res.status(403).json({ error: 'Site owner only' });
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
          // Staff are "always here" — no visit row.
          if (f.role === 'staff') { created++; continue; }
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
      const migrateCallerId = (req.headers['x-user-id'] ?? req.headers['x-admin-id']) as string | undefined;
      if (!migrateCallerId) return res.status(401).json({ error: 'Unauthorized' });
      const db = getDb();
      if (!(await callerIsOwner(db, migrateCallerId))) return res.status(403).json({ error: 'Site owner only' });
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
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false`;
      await db`UPDATE users SET role = 'admin' WHERE is_admin = true AND role = 'guest'`;
      // Bootstrap the site owner: the earliest-created user, only if none set yet.
      await db`
        UPDATE users SET is_owner = true
        WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM users WHERE is_owner = true)
      `;
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
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS room           TEXT`;
      // Per-day opt-outs (today-scoped, like tonight_aperitif): a column = CURRENT_DATE
      // means the member is skipping that sitting today; resets automatically next day.
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS skip_lunch_date    DATE`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS skip_dinner_date   DATE`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS skip_aperitif_date DATE`;
      // After-lunch / after-dinner hot drinks (today-scoped like the skips): a
      // single choice per sitting, applied only when hotdrink_date = CURRENT_DATE,
      // so both reset automatically each day. (The older *_count columns are left
      // in place, unused, from the earlier multi-count version.)
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS hotdrink_date DATE`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS lunch_drink   TEXT`;
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS dinner_drink  TEXT`;
      // A persistent personal note of cheeses this person enjoys (not date-scoped).
      await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS cheese_notes TEXT`;
      // Allow status-only rows (not coming / undecided) with no dates.
      await db`ALTER TABLE visits ALTER COLUMN arrive_date DROP NOT NULL`;
      await db`ALTER TABLE visits ALTER COLUMN depart_date DROP NOT NULL`;
      await db`ALTER TABLE visits ALTER COLUMN arrive_slot DROP NOT NULL`;
      await db`ALTER TABLE visits ALTER COLUMN depart_slot DROP NOT NULL`;
      // Date-ranged room allocations (source of truth going forward). `visits.room`
      // is kept as a legacy/fallback column and backfilled once below.
      await db`
        CREATE TABLE IF NOT EXISTS room_allocations (
          id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          room       TEXT        NOT NULL,
          start_date DATE        NOT NULL,
          end_date   DATE        NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await db`CREATE INDEX IF NOT EXISTS room_alloc_user_idx ON room_allocations(user_id)`;
      await db`CREATE INDEX IF NOT EXISTS room_alloc_room_date_idx ON room_allocations(room, start_date, end_date)`;
      // One-time backfill: turn each existing single-room allocation into a whole-stay
      // segment. Idempotent — the NOT EXISTS guard means re-running never duplicates,
      // and owner-default rooms (visits.room IS NULL) are left to client/server synthesis.
      await db`
        INSERT INTO room_allocations (user_id, room, start_date, end_date)
        SELECT v.user_id, v.room, v.arrive_date, v.depart_date
        FROM visits v
        WHERE v.room IS NOT NULL
          AND v.arrive_date IS NOT NULL
          AND v.depart_date IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM room_allocations ra WHERE ra.user_id = v.user_id)
      `;
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
      await db`
        CREATE TABLE IF NOT EXISTS event_rsvps (
          event_id   UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          user_id    UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
          status     TEXT        NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (event_id, user_id)
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
