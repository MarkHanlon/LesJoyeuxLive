import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const db = getDb();

  await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS aperitif TEXT`;
  await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_aperitif TEXT`;
  await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_date DATE`;
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'guest'`;
  await db`UPDATE users SET role = 'admin' WHERE is_admin = true AND role = 'guest'`;

  const [caller] = await db`
    SELECT id FROM users WHERE id = ${userId} AND status = 'approved'
  `;
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

  res.status(200).json(members);
}
