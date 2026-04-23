import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query as { id: string };
  const adminId = req.headers['x-admin-id'] as string | undefined;
  if (!adminId) return res.status(401).json({ error: 'Unauthorized' });

  const db = getDb();

  const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  if (id === adminId) return res.status(400).json({ error: 'Cannot remove yourself' });

  const [target] = await db`SELECT id, is_admin FROM users WHERE id = ${id}`;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_admin) return res.status(400).json({ error: 'Cannot remove another admin' });

  await db`DELETE FROM users WHERE id = ${id}`;

  res.status(200).json({ ok: true });
}
