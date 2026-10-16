// MIRVA's marble: faint veins for the light rooms of the site and pale ones for the dark rooms, drawn here (no stock
// texture) and saved as small transparent WebP files: `node scripts/marble.mjs`. The same smoky marble is in the
// fitting room behind the presentation models, so the page and the pictures are one room.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "brand");
const W = 1600, H = 1200;

// A seeded random, so the texture is the same every time it is made.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// One vein: a long smooth line that wanders, with a few thin branches.
function vein(x, y, angle, length, width) {
  let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
  const branches = [];
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    angle += (rnd() - 0.5) * 0.7;
    const step = length / steps;
    const cx = x + Math.cos(angle) * step * 0.5 + (rnd() - 0.5) * 40, cy = y + Math.sin(angle) * step * 0.5 + (rnd() - 0.5) * 40;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    d += ` Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    if (rnd() < 0.3) branches.push([x, y, angle + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.6), length * (0.15 + rnd() * 0.2)]);
  }
  return { d, width, branches };
}

function svg(colour, strength) {
  const lines = [], glow = [];
  for (let i = 0; i < 7; i++) {
    const v = vein(-200 + rnd() * 600, rnd() * H, -0.35 + rnd() * 0.5, 1500 + rnd() * 700, 0.8 + rnd() * 1.6);
    glow.push(`<path d="${v.d}" stroke-width="${(v.width * 9).toFixed(1)}" stroke-opacity="${(strength * 0.22).toFixed(3)}"/>`);
    lines.push(`<path d="${v.d}" stroke-width="${v.width.toFixed(2)}" stroke-opacity="${(strength * (0.6 + rnd() * 0.4)).toFixed(3)}"/>`);
    for (const [bx, by, ba, bl] of v.branches) {
      const b = vein(bx, by, ba, bl, 0.4 + rnd() * 0.5);
      lines.push(`<path d="${b.d}" stroke-width="${b.width.toFixed(2)}" stroke-opacity="${(strength * 0.55).toFixed(3)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="stone" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="3" seed="11" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="38" xChannelSelector="R" yChannelSelector="G"/>
      <feGaussianBlur stdDeviation="0.6"/>
    </filter>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="3" seed="11" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="38" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="7"/></filter>
  </defs>
  <g fill="none" stroke="${colour}" stroke-linecap="round" filter="url(#soft)">${glow.join("")}</g>
  <g fill="none" stroke="${colour}" stroke-linecap="round" filter="url(#stone)">${lines.join("")}</g>
</svg>`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, colour, strength] of [["marble-light", "#2a2520", 0.1], ["marble-dark", "#fff", 0.1]]) {
  seed = 7;
  const file = path.join(OUT, `${name}.webp`);
  await sharp(Buffer.from(svg(colour, strength))).webp({ quality: 72, alphaQuality: 70, effort: 6 }).toFile(file);
  console.log(path.relative(ROOT, file), Math.round(fs.statSync(file).size / 1024), "KB");
}
