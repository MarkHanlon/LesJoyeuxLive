import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { getDb } from './db';

const scryptAsync = promisify(scrypt);

async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scryptAsync(pin, salt, 64)) as Buffer;
  return `${salt}:${buf.toString('hex')}`;
}

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const hashBuf = Buffer.from(hash, 'hex');
  const derived = (await scryptAsync(pin, salt, 64)) as Buffer;
  return timingSafeEqual(hashBuf, derived);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { name, pin } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4 digits' });
    }

    const db = getDb();
    const trimmedName = name.trim();

    const existing = await db`
      SELECT id, name, status, is_admin AS "isAdmin", pin_hash
      FROM users WHERE LOWER(name) = LOWER(${trimmedName})
      LIMIT 1
    `;

    if (existing.length > 0) {
      const u = existing[0];
      if (!u.pin_hash || !(await verifyPin(pin, u.pin_hash))) {
        return res.status(401).json({ error: 'Wrong PIN for this name' });
      }
      return res.status(200).json({ id: u.id, name: u.name, status: u.status, isAdmin: u.isAdmin });
    }

    const [{ count }] = await db`SELECT COUNT(*) AS count FROM users`;
    const isFirst = Number(count) === 0;
    const pinHash = await hashPin(pin);

    const [user] = await db`
      INSERT INTO users (name, pin_hash, status, is_admin)
      VALUES (
        ${trimmedName},
        ${pinHash},
        ${isFirst ? 'approved' : 'pending'},
        ${isFirst}
      )
      RETURNING id, name, status, is_admin AS "isAdmin", created_at AS "createdAt"
    `;

    res.status(201).json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
