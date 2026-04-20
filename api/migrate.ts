import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const db = getDb();

    await db`
      CREATE TABLE IF NOT EXISTS users (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT        NOT NULL,
        status     TEXT        NOT NULL DEFAULT 'pending',
        is_admin   BOOLEAN     NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const [{ column_exists }] = await db`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'pin_hash'
      ) AS column_exists
    `;

    if (!column_exists) {
      await db`ALTER TABLE users ADD COLUMN pin_hash TEXT`;
      await db`TRUNCATE users`;
    }

    await db`
      CREATE TABLE IF NOT EXISTS visits (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        arrive_date DATE        NOT NULL,
        arrive_slot TEXT        NOT NULL,
        save_lunch  BOOLEAN     NOT NULL DEFAULT false,
        save_dinner BOOLEAN     NOT NULL DEFAULT false,
        depart_date DATE        NOT NULL,
        depart_slot TEXT        NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint   TEXT        NOT NULL UNIQUE,
        p256dh     TEXT        NOT NULL,
        auth       TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    res.status(200).json({ ok: true, message: 'Database ready' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
