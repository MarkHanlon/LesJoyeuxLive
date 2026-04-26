import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../db';
import { sendPushToAll } from '../../push/_send';

const VALID_ROLES = ['guest', 'staff', 'admin'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { action, id } = req.query as { action: string; id: string };
  const adminId = req.headers['x-admin-id'] as string | undefined;
  if (!adminId) return res.status(401).json({ error: 'Unauthorized' });

  const db = getDb();
  const [admin] = await db`SELECT id FROM users WHERE id = ${adminId} AND is_admin = true`;
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  if (action === 'approve') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const [user] = await db`
        UPDATE users SET status = 'approved'
        WHERE id = ${id}
        RETURNING id, name, status, is_admin AS "isAdmin"
      `;
      if (!user) return res.status(404).json({ error: 'User not found' });
      await sendPushToAll(db, {
        title: '👋 New family member!',
        body: `${user.name} has just joined Les Joyeux Live.`,
      });
      return res.status(200).json(user);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'remove') {
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
    if (id === adminId) return res.status(400).json({ error: 'Cannot remove yourself' });
    const [target] = await db`SELECT id, is_admin FROM users WHERE id = ${id}`;
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.is_admin) return res.status(400).json({ error: 'Cannot remove another admin' });
    await db`DELETE FROM users WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  if (action === 'role') {
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    if (id === adminId) return res.status(400).json({ error: 'Cannot change your own role' });
    const { role } = req.body ?? {};
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    await db`
      UPDATE users SET role = ${role}, is_admin = ${role === 'admin'}
      WHERE id = ${id}
    `;
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ error: 'Unknown action' });
}
