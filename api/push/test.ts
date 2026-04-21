import type { VercelRequest, VercelResponse } from '@vercel/node';
import webpush from 'web-push';
import { getDb } from '../db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

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

  if (subs.length === 0) {
    return res.status(404).json({ error: 'No admin subscriptions found' });
  }

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: 'Test 🔔', body: 'Push is working!', url: '/' })
      );
      return { admin: sub.name, endpoint: sub.endpoint.slice(0, 40) + '...' };
    })
  );

  res.json({ results: results.map(r => r.status === 'fulfilled' ? { ok: true, ...r.value } : { ok: false, error: (r as any).reason?.message }) });
}
