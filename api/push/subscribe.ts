import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, subscription } = req.body ?? {};
  if (
    !userId ||
    typeof userId !== 'string' ||
    !subscription?.endpoint ||
    !subscription?.keys?.p256dh ||
    !subscription?.keys?.auth
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

  res.status(201).json({ ok: true });
}
