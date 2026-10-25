// One laurel branch on an oval, open at the top: the sidebar logo and the app
// mark (BrandMarkIcon) both draw it, mirrored, as a crown.

interface LaurelOptions {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Where the stem ends, upper left (degrees, 90 is the bottom). */
  endDeg: number;
  /** Where the stem starts, just past the bottom, so the two branches cross. */
  stemStartDeg: number;
  firstStep: number;
  step: number;
  /** Distance kept free of leaves before the tip leaf. */
  endGap: number;
  leafLen: number;
  leafW: number;
  /** How much smaller the leaves get toward the tip. */
  falloff: number;
  tipSize: number;
  /** Distance of a berry from the stem; 0 draws none. */
  berryOffset: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function buildLaurelBranch(o: LaurelOptions) {
  const at = (a: number) => [o.cx + o.rx * Math.cos(a), o.cy + o.ry * Math.sin(a)];
  // A pointed leaf from its base, along the direction (dx, dy).
  const leafPath = (x: number, y: number, dx: number, dy: number, size: number) => {
    const l = o.leafLen * size;
    const w = o.leafW * size;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    return {
      d: `M0 0Q${l * 0.45} ${-w} ${l} 0Q${l * 0.45} ${w} 0 0Z`,
      transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${deg.toFixed(1)})`,
    };
  };

  // Leaves sit at even distances along the stem (the oval is flat, so even
  // angles would bunch them).
  const a0 = rad(100);
  const a1 = rad(o.endDeg);
  const samples: [number, number][] = [];
  let length = 0;
  let prev = at(a0);
  for (let i = 0; i <= 600; i++) {
    const a = a0 + ((a1 - a0) * i) / 600;
    const p = at(a);
    length += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    samples.push([a, length]);
    prev = p;
  }

  const leaves: { d: string; transform: string; opacity: number }[] = [];
  const berries: [number, number][] = [];
  let node = 0;
  for (let s = o.firstStep; s < length - o.endGap; s += o.step, node++) {
    const a = samples.find(([, l]) => l >= s)![0];
    const [x, y] = at(a);
    const size = 1 - o.falloff * (s / length);
    const tx = -o.rx * Math.sin(a);
    const ty = o.ry * Math.cos(a);
    const tl = Math.hypot(tx, ty);
    const nx = o.ry * Math.cos(a);
    const ny = o.rx * Math.sin(a);
    const nl = Math.hypot(nx, ny);
    const t = [tx / tl, ty / tl];
    const n = [nx / nl, ny / nl];
    leaves.push({
      ...leafPath(x, y, t[0] * 0.8 + n[0] * 0.6, t[1] * 0.8 + n[1] * 0.6, size),
      opacity: 1,
    });
    leaves.push({
      ...leafPath(x, y, t[0] * 0.8 - n[0] * 0.6, t[1] * 0.8 - n[1] * 0.6, size * 0.85),
      opacity: 0.78,
    });
    if (o.berryOffset && node % 3 === 1) {
      berries.push([x - n[0] * o.berryOffset, y - n[1] * o.berryOffset]);
    }
  }

  // Tip leaf, pointing on along the stem.
  const [ex, ey] = at(a1);
  const tx = -o.rx * Math.sin(a1);
  const ty = o.ry * Math.cos(a1);
  const tl = Math.hypot(tx, ty);
  leaves.push({ ...leafPath(ex, ey, tx / tl, ty / tl, o.tipSize), opacity: 1 });

  const [sx, sy] = at(rad(o.stemStartDeg));
  const stem = `M${sx} ${sy}A${o.rx} ${o.ry} 0 0 1 ${ex} ${ey}`;
  return { stem, leaves, berries };
}

/** A small laurel sprig with one orange berry: the success mark on toasts. */
export function LaurelSprig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" fill="currentColor" className={className} aria-hidden="true">
      <path
        d="M4 16C7 12 9 8 14 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M6.2 12.6C4 12.8 2.4 11.6 1.8 10.2 3.8 9.7 5.6 10.6 6.2 12.6Z" />
      <path d="M6.6 12.2C6.4 10 7.5 8.4 9 7.8 9.5 9.9 8.5 11.6 6.6 12.2Z" />
      <path d="M8.7 9.4C6.6 9.2 5.4 7.8 5.1 6.3 7.2 6.2 8.6 7.4 8.7 9.4Z" />
      <path d="M9.2 9C9.4 6.9 10.8 5.6 12.4 5.4 12.5 7.4 11.2 8.8 9.2 9Z" />
      <path d="M11.4 5.9C9.5 5.3 8.8 3.7 8.9 2.2 10.9 2.6 11.8 4.1 11.4 5.9Z" />
      <circle cx="13.3" cy="6.6" r="1.1" fill="var(--accent, currentColor)" />
    </svg>
  );
}

/** Draws a branch in currentColor; `mirrorAt` flips it around that width. */
export function LaurelBranch({
  branch,
  stemWidth,
  berryRadius = 0,
  mirrorAt,
}: {
  branch: ReturnType<typeof buildLaurelBranch>;
  stemWidth: number;
  berryRadius?: number;
  mirrorAt?: number;
}) {
  return (
    <g
      fill="currentColor"
      transform={mirrorAt ? `translate(${mirrorAt} 0) scale(-1 1)` : undefined}
    >
      <path d={branch.stem} fill="none" stroke="currentColor" strokeWidth={stemWidth} />
      {branch.leaves.map((leaf, i) => (
        <path key={i} d={leaf.d} transform={leaf.transform} opacity={leaf.opacity} />
      ))}
      {branch.berries.map(([x, y], i) => (
        <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r={berryRadius} fill="var(--accent)" />
      ))}
    </g>
  );
}
