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

export async function sendPushToAdmins(
  db: NeonQueryFunction<false, false>,
  payload: Payload
): Promise<void> {
  if (!initWebPush()) return;

  const subscriptions = await db`
    SELECT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id
    WHERE u.is_admin = true
  `;

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
