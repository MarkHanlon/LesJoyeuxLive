import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../db';
import { sendPushToAll } from '../../push/_send';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const adminId = req.headers['x-admin-id'] as string | undefined;
    if (!adminId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const db = getDb();

    const [admin] = await db`
      SELECT id FROM users WHERE id = ${adminId} AND is_admin = true
    `;
    if (!admin) return res.status(403).json({ error: 'Forbidden' });

    const [user] = await db`
      UPDATE users
      SET    status = 'approved'
      WHERE  id = ${id as string}
      RETURNING id, name, status, is_admin AS "isAdmin"
    `;

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Notify everyone that a new family member has been welcomed
    await sendPushToAll(db, {
      title: '👋 New family member!',
      body: `${user.name} has just joined Les Joyeux Live.`,
    });

    res.status(200).json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
