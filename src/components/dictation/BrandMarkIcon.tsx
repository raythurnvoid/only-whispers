import { buildLaurelBranch, LaurelBranch } from "../laurel";

interface BrandMarkIconProps {
  size?: number;
  className?: string;
}

// The small-size app mark: fewer, bigger leaves than the app icon, no grille
// and no "O·W" tie, so it stays clear at 20-24px.
const BRANCH = buildLaurelBranch({
  cx: 512,
  cy: 478,
  rx: 300,
  ry: 318,
  endDeg: 238,
  stemStartDeg: 78,
  firstStep: 64,
  step: 92,
  endGap: 92,
  leafLen: 150,
  leafW: 50,
  falloff: 0.3,
  tipSize: 0.75,
  berryOffset: 0,
});

/**
 * The app mark: a laurel crown around a studio microphone. Laurel and
 * microphone take the Palazzo --laurel and --mark-mic colors, and
 * currentColor where those are not set.
 */
export function BrandMarkIcon({ size = 24, className }: BrandMarkIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g style={{ color: "var(--laurel, currentColor)" }}>
        <LaurelBranch branch={BRANCH} stemWidth={22} />
        <LaurelBranch branch={BRANCH} stemWidth={22} mirrorAt={1024} />
      </g>
      <g style={{ color: "var(--mark-mic, currentColor)" }}>
        <rect x="434" y="262" width="156" height="262" rx="78" fill="currentColor" />
        <path
          d="M384 430v36a128 128 0 0 0 256 0v-36"
          stroke="currentColor"
          strokeWidth="34"
          strokeLinecap="round"
        />
        <rect x="499" y="592" width="26" height="120" fill="currentColor" />
        <rect x="422" y="700" width="180" height="34" rx="17" fill="currentColor" />
      </g>
    </svg>
  );
}
