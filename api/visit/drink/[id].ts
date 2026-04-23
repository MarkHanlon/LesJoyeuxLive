import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query as { id: string };
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId || userId !== id) return res.status(401).json({ error: 'Unauthorized' });

  const { aperitif, tonight } = req.body ?? {};
  if (typeof aperitif !== 'string' || !aperitif) {
    return res.status(400).json({ error: 'aperitif required' });
  }

  const db = getDb();
  await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_aperitif TEXT`;
  await db`ALTER TABLE visits ADD COLUMN IF NOT EXISTS tonight_date DATE`;

  if (tonight) {
    await db`
      UPDATE visits
      SET tonight_aperitif = ${aperitif},
          tonight_date     = CURRENT_DATE
      WHERE user_id = ${id}
    `;
  } else {
    await db`
      UPDATE visits
      SET aperitif         = ${aperitif},
          tonight_aperitif = NULL,
          tonight_date     = NULL
      WHERE user_id = ${id}
    `;
  }

  res.status(200).json({ ok: true });
}
