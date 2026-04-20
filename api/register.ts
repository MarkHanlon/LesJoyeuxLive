import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const db = getDb();
    const trimmedName = name.trim();

    const [{ count }] = await db`SELECT COUNT(*) AS count FROM users`;
    const isFirst = Number(count) === 0;

    const [user] = await db`
      INSERT INTO users (name, status, is_admin)
      VALUES (
        ${trimmedName},
        ${isFirst ? 'approved' : 'pending'},
        ${isFirst}
      )
      RETURNING
        id,
        name,
        status,
        is_admin   AS "isAdmin",
        created_at AS "createdAt"
    `;

    res.status(201).json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
