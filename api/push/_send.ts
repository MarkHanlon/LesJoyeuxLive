import webpush from 'web-push';
import type { NeonQueryFunction } from '@neondatabase/serverless';

type Payload = { title: string; body: string; url?: string };

function initWebPush() {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

async function sendToSubscriptions(
  db: NeonQueryFunction<false, false>,
  subscriptions: { endpoint: string; p256dh: string; auth: string }[],
  payload: Payload
): Promise<void> {
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
        }
      }
    })
  );
}

export async function sendPushToAdmins(
  db: NeonQueryFunction<false, false>,
  payload: Payload
): Promise<void> {
  if (!initWebPush()) return;
  const subs = await db`
    SELECT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id
    WHERE u.is_admin = true
  `;
  await sendToSubscriptions(db, subs as any, payload);
}

export async function sendPushToAll(
  db: NeonQueryFunction<false, false>,
  payload: Payload
): Promise<void> {
  if (!initWebPush()) return;
  const subs = await db`
    SELECT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id
    WHERE u.status = 'approved'
  `;
  await sendToSubscriptions(db, subs as any, payload);
}
