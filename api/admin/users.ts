import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const adminId = req.headers['x-admin-id'] as string | undefined;
    if (!adminId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();

    const [admin] = await db`
      SELECT id FROM users WHERE id = ${adminId} AND is_admin = true
    `;
    if (!admin) return res.status(403).json({ error: 'Forbidden' });

    const users = await db`
      SELECT
        id,
        name,
        status,
        is_admin   AS "isAdmin",
        created_at AS "createdAt"
      FROM  users
      WHERE is_admin = false AND status = 'pending'
      ORDER BY created_at ASC
    `;

    res.status(200).json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
