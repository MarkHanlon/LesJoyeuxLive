import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const db = getDb();

  const [caller] = await db`
    SELECT id FROM users WHERE id = ${userId} AND status = 'approved'
  `;
  if (!caller) return res.status(403).json({ error: 'Forbidden' });

  const members = await db`
    SELECT
      u.id,
      u.name,
      u.is_admin                        AS "isAdmin",
      v.arrive_date::text               AS "arriveDate",
      v.arrive_slot                     AS "arriveSlot",
      v.depart_date::text               AS "departDate",
      v.depart_slot                     AS "departSlot",
      v.aperitif
    FROM  users u
    LEFT  JOIN visits v ON v.user_id = u.id
    WHERE u.status = 'approved'
    ORDER BY u.name ASC
  `;

  res.status(200).json(members);
}
