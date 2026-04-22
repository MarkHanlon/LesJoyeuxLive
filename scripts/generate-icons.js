const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// French château SVG — designed for clarity at small sizes
// Colours match the app palette
const chateauSvg = (size, extraPad = 0) => {
  const p = extraPad; // extra inset for maskable safe-zone
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <!-- Background -->
  <rect width="512" height="512" fill="#1C3D2A"/>

  <!-- Sky gradient strip -->
  <rect x="0" y="0" width="512" height="300" fill="#243F2E"/>

  <!-- ── CHÂTEAU WALLS ── -->

  <!-- Main connecting body -->
  <rect x="${130+p}" y="${265+p}" width="${252-2*p}" height="${155-p}" fill="#E2D4A8"/>

  <!-- Left turret -->
  <rect x="${86+p}" y="${210+p}" width="${86-p}" height="${210-p}" fill="#D4C494"/>

  <!-- Right turret -->
  <rect x="${340+p}" y="${210+p}" width="${86-p}" height="${210-p}" fill="#D4C494"/>

  <!-- Central tower (tallest) -->
  <rect x="${206+p}" y="${155+p}" width="${100-p}" height="${265-p}" fill="#E2D4A8"/>

  <!-- ── ROOFTOPS (pointed — very French) ── -->

  <!-- Left turret cone -->
  <polygon points="${129+p},${108+p} ${86+p},${213+p} ${172+p},${213+p}" fill="#7B2D1E"/>

  <!-- Right turret cone -->
  <polygon points="${383+p},${108+p} ${340+p},${213+p} ${426+p},${213+p}" fill="#7B2D1E"/>

  <!-- Central tower cone (tallest, accent colour) -->
  <polygon points="${256},${48+p} ${206+p},${158+p} ${306+p},${158+p}" fill="#C85A2E"/>

  <!-- ── WINDOWS (arched) ── -->

  <!-- Left turret window -->
  <rect x="${104+p}" y="${243+p}" width="${50-p}" height="${62-p}" rx="${25}" fill="#1C3D2A"/>
  <rect x="${109+p}" y="${248+p}" width="${40-p}" height="${52-p}" rx="${20}" fill="#2A5040"/>

  <!-- Right turret window -->
  <rect x="${358+p}" y="${243+p}" width="${50-p}" height="${62-p}" rx="${25}" fill="#1C3D2A"/>
  <rect x="${363+p}" y="${248+p}" width="${40-p}" height="${52-p}" rx="${20}" fill="#2A5040"/>

  <!-- Central tower upper window -->
  <rect x="${229+p}" y="${182+p}" width="${54-p}" height="${66-p}" rx="${27}" fill="#1C3D2A"/>
  <rect x="${234+p}" y="${187+p}" width="${44-p}" height="${56-p}" rx="${22}" fill="#2A5040"/>

  <!-- Main body windows -->
  <rect x="${155+p}" y="${290+p}" width="${48-p}" height="${58-p}" rx="${24}" fill="#1C3D2A"/>
  <rect x="${160+p}" y="${295+p}" width="${38-p}" height="${48-p}" rx="${19}" fill="#2A5040"/>

  <rect x="${309+p}" y="${290+p}" width="${48-p}" height="${58-p}" rx="${24}" fill="#1C3D2A"/>
  <rect x="${314+p}" y="${295+p}" width="${38-p}" height="${48-p}" rx="${19}" fill="#2A5040"/>

  <!-- ── ENTRANCE DOOR ── -->
  <rect x="${231+p}" y="${340+p}" width="${50-p}" height="${80-p}" rx="${25}" fill="#1C3D2A"/>

  <!-- ── BATTLEMENTS (crenellations) ── -->
  <!-- Left turret top -->
  <rect x="${86+p}" y="${196+p}" width="16" height="18" fill="#D4C494"/>
  <rect x="${110+p}" y="${196+p}" width="16" height="18" fill="#D4C494"/>
  <rect x="${134+p}" y="${196+p}" width="16" height="18" fill="#D4C494"/>
  <rect x="${158+p}" y="${196+p}" width="14" height="18" fill="#D4C494"/>

  <!-- Right turret top -->
  <rect x="${340+p}" y="${196+p}" width="16" height="18" fill="#D4C494"/>
  <rect x="${364+p}" y="${196+p}" width="16" height="18" fill="#D4C494"/>
  <rect x="${388+p}" y="${196+p}" width="16" height="18" fill="#D4C494"/>
  <rect x="${412+p}" y="${196+p}" width="10" height="18" fill="#D4C494"/>

  <!-- ── FLAGS ── -->
  <!-- Left flag -->
  <line x1="${129+p}" y1="${72+p}" x2="${129+p}" y2="${110+p}" stroke="#E2D4A8" stroke-width="5" stroke-linecap="round"/>
  <polygon points="${129+p},${72+p} ${162+p},${84+p} ${129+p},${96+p}" fill="#C85A2E"/>

  <!-- Right flag -->
  <line x1="${383+p}" y1="${72+p}" x2="${383+p}" y2="${110+p}" stroke="#E2D4A8" stroke-width="5" stroke-linecap="round"/>
  <polygon points="${383+p},${72+p} ${416+p},${84+p} ${383+p},${96+p}" fill="#C85A2E"/>

  <!-- Central flag (tallest) -->
  <line x1="256" y1="${14+p}" x2="256" y2="${50+p}" stroke="#E2D4A8" stroke-width="6" stroke-linecap="round"/>
  <polygon points="256,${14+p} ${296+p},${28+p} 256,${42+p}" fill="#C85A2E"/>

  <!-- ── GROUND & LANDSCAPE ── -->
  <!-- Grass -->
  <rect x="0" y="420" width="512" height="92" fill="#2D5A3D"/>
  <!-- Moat reflection -->
  <ellipse cx="256" cy="422" rx="190" ry="14" fill="#1C3D2A" opacity="0.6"/>

  <!-- ── DECORATIVE GOLD BORDER ── -->
  <rect x="10" y="10" width="492" height="492" fill="none" stroke="#C8973D" stroke-width="10" rx="4"/>
</svg>`;
};

async function generate() {
  const publicDir = path.join(__dirname, '..', 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  const jobs = [
    { file: 'icon-192.png',          size: 192, pad: 0  },
    { file: 'icon-512.png',          size: 512, pad: 0  },
    { file: 'icon-512-maskable.png', size: 512, pad: 20 },
    { file: 'apple-touch-icon.png',  size: 180, pad: 0  },
    { file: 'favicon.ico',           size: 32,  pad: 0  },
  ];

  for (const { file, size, pad } of jobs) {
    const svg = Buffer.from(chateauSvg(size, pad));
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(path.join(publicDir, file.replace('.ico', '.png')));
    console.log(`✓ ${file} (${size}x${size})`);
  }
}

generate().catch((err) => { console.error(err); process.exit(1); });
