import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../db';

const VALID_SLOTS = ['morning', 'lunchtime', 'afternoon', 'dinnertime', 'evening'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query as { id: string };
  if (!id) return res.status(400).json({ error: 'Missing user id' });

  const db = getDb();

  // Ensure table exists (safe to run repeatedly)
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
  await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS aperitif TEXT`;

  if (req.method === 'GET') {
    const rows = await db`
      SELECT arrive_date::text, arrive_slot, save_lunch, save_dinner, depart_date::text, depart_slot, aperitif
      FROM visits WHERE user_id = ${id} LIMIT 1
    `;
    if (rows.length === 0) return res.status(404).json({ visit: null });
    return res.status(200).json(rows[0]);
  }

  if (req.method === 'POST') {
    const { arriveDate, arriveSlot, saveLunch, saveDinner, departDate, departSlot, aperitif } = req.body ?? {};

    if (!arriveDate || !departDate) return res.status(400).json({ error: 'Dates required' });
    if (!VALID_SLOTS.includes(arriveSlot) || !VALID_SLOTS.includes(departSlot))
      return res.status(400).json({ error: 'Invalid time slot' });
    if (departDate < arriveDate) return res.status(400).json({ error: 'Departure must be on or after arrival' });

    const aperitifVal = typeof aperitif === 'string' && aperitif ? aperitif : null;

    const [row] = await db`
      INSERT INTO visits (user_id, arrive_date, arrive_slot, save_lunch, save_dinner, depart_date, depart_slot, aperitif)
      VALUES (${id}, ${arriveDate}, ${arriveSlot}, ${!!saveLunch}, ${!!saveDinner}, ${departDate}, ${departSlot}, ${aperitifVal})
      ON CONFLICT (user_id) DO UPDATE SET
        arrive_date = EXCLUDED.arrive_date,
        arrive_slot = EXCLUDED.arrive_slot,
        save_lunch  = EXCLUDED.save_lunch,
        save_dinner = EXCLUDED.save_dinner,
        depart_date = EXCLUDED.depart_date,
        depart_slot = EXCLUDED.depart_slot,
        aperitif    = EXCLUDED.aperitif,
        updated_at  = NOW()
      RETURNING arrive_date::text, arrive_slot, save_lunch, save_dinner, depart_date::text, depart_slot, aperitif
    `;
    return res.status(200).json(row);
  }

  res.status(405).json({ error: 'Method not allowed' });
}
