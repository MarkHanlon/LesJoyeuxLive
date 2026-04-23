import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../db';

const VALID_ROLES = ['guest', 'staff', 'admin'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query as { id: string };
  const adminId = req.headers['x-admin-id'] as string | undefined;
  if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
  if (id === adminId) return res.status(400).json({ error: 'Cannot change your own role' });

  const { role } = req.body ?? {};
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const db = getDb();

  const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  await db`
    UPDATE users
    SET role     = ${role},
        is_admin = ${role === 'admin'}
    WHERE id = ${id}
  `;

  res.status(200).json({ ok: true });
}
