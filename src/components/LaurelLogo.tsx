// The control panel logo: the app name on one line, centered over a small
// laurel crown (two branches crossing at the bottom, open at the top).

const W = 180;
const CX = 90;
const CY = 30;
const RX = 29;
const RY = 24;
const A0 = (100 * Math.PI) / 180;
const A1 = (235 * Math.PI) / 180;

const at = (a: number) => [CX + RX * Math.cos(a), CY + RY * Math.sin(a)];

// A pointed leaf from its base, along the direction (dx, dy).
const leafPath = (x: number, y: number, dx: number, dy: number, size: number) => {
  const l = 6 * size;
  const w = 2.2 * size;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    d: `M0 0Q${l * 0.45} ${-w} ${l} 0Q${l * 0.45} ${w} 0 0Z`,
    transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${deg.toFixed(1)})`,
  };
};

// One branch, drawn once at load. Leaves sit at even distances along the stem
// (the oval is flat, so even angles would bunch them).
function buildBranch() {
  const samples: [number, number][] = [];
  let length = 0;
  let prev = at(A0);
  for (let i = 0; i <= 600; i++) {
    const a = A0 + ((A1 - A0) * i) / 600;
    const p = at(a);
    length += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    samples.push([a, length]);
    prev = p;
  }

  const leaves: { d: string; transform: string; opacity: number }[] = [];
  const berries: [number, number][] = [];
  let node = 0;
  for (let s = 3; s < length - 4; s += 4.6, node++) {
    const a = samples.find(([, l]) => l >= s)![0];
    const [x, y] = at(a);
    const size = 1 - 0.35 * (s / length);
    const tx = -RX * Math.sin(a);
    const ty = RY * Math.cos(a);
    const tl = Math.hypot(tx, ty);
    const nx = RY * Math.cos(a);
    const ny = RX * Math.sin(a);
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
    if (node % 3 === 1) berries.push([x - n[0] * 3, y - n[1] * 3]);
  }

  // Tip leaf, pointing on along the stem.
  const [ex, ey] = at(A1);
  const tx = -RX * Math.sin(A1);
  const ty = RY * Math.cos(A1);
  const tl = Math.hypot(tx, ty);
  leaves.push({ ...leafPath(ex, ey, tx / tl, ty / tl, 0.7), opacity: 1 });

  // The stem starts past the bottom, so the two branches cross there.
  const [sx, sy] = at((80 * Math.PI) / 180);
  const stem = `M${sx} ${sy}A${RX} ${RY} 0 0 1 ${ex} ${ey}`;
  return { stem, leaves, berries };
}

const BRANCH = buildBranch();

function Branch({ mirrored }: { mirrored?: boolean }) {
  return (
    <g fill="currentColor" transform={mirrored ? `translate(${W} 0) scale(-1 1)` : undefined}>
      <path d={BRANCH.stem} fill="none" stroke="currentColor" strokeWidth="1.1" />
      {BRANCH.leaves.map((leaf, i) => (
        <path key={i} d={leaf.d} transform={leaf.transform} opacity={leaf.opacity} />
      ))}
      {BRANCH.berries.map(([x, y], i) => (
        <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r="1.05" fill="var(--accent)" />
      ))}
    </g>
  );
}

export default function LaurelLogo() {
  return (
    <div className="relative mx-2 mt-1 mb-[18px] grid h-[60px] place-items-center">
      <svg
        viewBox={`0 0 ${W} 60`}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full text-(--laurel)"
      >
        <Branch />
        <Branch mirrored />
      </svg>
      {/* The name sits on a strip of the window's own marble (both fixed, so they
          line up): it hides the leaves behind the letters and is otherwise unseen. */}
      <div className="pz-window pz-display relative whitespace-nowrap px-2 pt-[3px] pb-px text-[12.5px] font-semibold tracking-[0.12em] text-foreground uppercase">
        Only Whispers
      </div>
    </div>
  );
}
