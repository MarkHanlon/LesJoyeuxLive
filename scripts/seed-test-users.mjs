// Seed 10 test users into the live system
// Usage: node scripts/seed-test-users.mjs
// All users get PIN 1234

const BASE = 'https://les-joyeux-live.vercel.app';
const ADMIN_ID = '1612220c-96f9-406f-8a6d-dba3105e887c';
const PIN = '1234';

const USERS = [
  { name: 'Pappy',  arrive: '2026-08-01', arriveSlot: 'morning',    depart: '2026-08-14', departSlot: 'afternoon', aperitif: 'Pastis'      },
  { name: 'Joan',   arrive: '2026-08-02', arriveSlot: 'lunchtime',  depart: '2026-08-09', departSlot: 'morning',   aperitif: 'Kir Royale'  },
  { name: 'Emma',   arrive: '2026-08-03', arriveSlot: 'afternoon',  depart: '2026-08-16', departSlot: 'lunchtime', aperitif: 'Rosé'        },
  { name: 'Simon',  arrive: '2026-08-01', arriveSlot: 'dinnertime', depart: '2026-08-08', departSlot: 'afternoon', aperitif: 'Beer'        },
  { name: 'Izzy',   arrive: '2026-08-05', arriveSlot: 'morning',    depart: '2026-08-12', departSlot: 'morning',   aperitif: 'Crémant'     },
  { name: 'Sam',    arrive: '2026-08-08', arriveSlot: 'lunchtime',  depart: '2026-08-15', departSlot: 'afternoon', aperitif: 'G&T'         },
  { name: 'Hayley', arrive: '2026-08-03', arriveSlot: 'afternoon',  depart: '2026-08-10', departSlot: 'morning',   aperitif: 'Kir'         },
  { name: 'Jack',   arrive: '2026-08-10', arriveSlot: 'morning',    depart: '2026-08-17', departSlot: 'afternoon', aperitif: 'Red Wine'    },
  { name: 'Beth',   arrive: '2026-08-06', arriveSlot: 'evening',    depart: '2026-08-13', departSlot: 'lunchtime', aperitif: 'Lillet'      },
  { name: 'Max',    arrive: '2026-08-12', arriveSlot: 'afternoon',  depart: '2026-08-22', departSlot: 'morning',   aperitif: 'White Wine'  },
];

async function post(path, body, headers = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}

async function main() {
  for (const u of USERS) {
    process.stdout.write(`${u.name.padEnd(8)}`);

    // 1. Register
    const reg = await post('/api/register', { name: u.name, pin: PIN });
    if (reg.status !== 200 && reg.status !== 201) {
      console.log(`  REGISTER FAILED (${reg.status}): ${JSON.stringify(reg.data)}`);
      continue;
    }
    const userId = reg.data.id;
    process.stdout.write(`  registered (${reg.status})`);

    // 2. Approve if pending
    if (reg.data.status === 'pending') {
      const appr = await post(
        `/api/admin/approve/${userId}`,
        {},
        { 'x-admin-id': ADMIN_ID },
      );
      process.stdout.write(appr.status === 200 ? '  approved' : `  APPROVE FAILED (${appr.status})`);
    } else {
      process.stdout.write('  (already approved)');
    }

    // 3. Set visit + aperitif
    const vis = await post(
      `/api/visit/${userId}`,
      {
        arriveDate:  u.arrive,
        arriveSlot:  u.arriveSlot,
        departDate:  u.depart,
        departSlot:  u.departSlot,
        saveLunch:   true,
        saveDinner:  true,
        aperitif:    u.aperitif,
      },
      { 'x-user-id': userId },
    );
    process.stdout.write(vis.status === 200 ? `  visit set  🍹 ${u.aperitif}` : `  VISIT FAILED (${vis.status})`);

    console.log();
  }

  console.log('\nDone! All test users seeded with PIN: ' + PIN);
}

main().catch(console.error);
