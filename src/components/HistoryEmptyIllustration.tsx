import { BrandMarkIcon } from "./dictation/BrandMarkIcon";

// The tablet's empty ledger: each row's numeral, line height and where its carved line ends.
const ROWS = [
  { numeral: "I", y: 108, end: 322 },
  { numeral: "II", y: 132, end: 300 },
  { numeral: "III", y: 156, end: 262 },
];

/** An Ionic column, 28x112: capital.svg, a fluted shaft, base.svg (src/assets/palazzo). */
function Column({ x, shaftFill }: { x: number; shaftFill: string }) {
  return (
    <g transform={`translate(${x} 72)`} fill="currentColor">
      <rect width="28" height="3" />
      <rect x="1.5" y="3.8" width="25" height=".8" opacity=".6" />
      <g fill="none" stroke="currentColor">
        <path d="M5 5.9H23M5 15.1Q14 11.2 23 15.1" />
        <circle cx="5" cy="10.5" r="4.6" />
        <circle cx="5" cy="10.5" r="2.6" strokeWidth=".8" />
        <circle cx="23" cy="10.5" r="4.6" />
        <circle cx="23" cy="10.5" r="2.6" strokeWidth=".8" />
      </g>
      <circle cx="5" cy="10.5" r="1.1" />
      <circle cx="23" cy="10.5" r="1.1" />
      <g opacity=".5">
        <ellipse cx="10.4" cy="10" rx="1.5" ry="2.1" />
        <ellipse cx="14" cy="10" rx="1.5" ry="2.1" />
        <ellipse cx="17.6" cy="10" rx="1.5" ry="2.1" />
      </g>
      <rect x="5" y="17.6" width="18" height="1" />
      <rect x="4" y="19.6" width="20" height="2.2" rx="1.1" opacity=".8" />
      <rect x="5" y="23" width="18" height="7" opacity=".12" />
      <rect x="5" y="23" width="1" height="7" />
      <rect x="22" y="23" width="1" height="7" />
      <rect x="5" y="30" width="18" height="60" fill={shaftFill} />
      <g transform="translate(0 90)">
        <rect x="5" width="18" height="1" opacity=".12" />
        <rect x="4" y="1" width="20" height="1.4" />
        <rect x="3" y="3.4" width="22" height="4" rx="2" opacity=".75" />
        <rect x="4.5" y="8.4" width="19" height="1" />
        <rect x="1.5" y="10.4" width="25" height="5" rx="2.5" opacity=".75" />
        <rect y="16.4" width="28" height="5.6" />
      </g>
    </g>
  );
}

/**
 * Home's empty history: a small temple whose tablet is an empty ledger, waiting
 * for its first line. Painted in Palazzo tokens, so one drawing serves both themes.
 */
export default function HistoryEmptyIllustration() {
  // Fixed ids: Home shows at most one empty state at a time.
  const shaftId = "history-empty-shaft";
  const eggId = "history-empty-egg";

  return (
    <svg
      width="440"
      height="200"
      viewBox="0 0 440 200"
      className="block h-auto max-w-full"
      style={{ color: "var(--ornament)" }}
      aria-hidden="true"
    >
      <defs>
        {/* Shaft flutes (shaft.svg). */}
        <pattern id={shaftId} x="5" width="18" height="8" patternUnits="userSpaceOnUse">
          <g fill="currentColor">
            <rect width="18" height="8" opacity=".12" />
            <rect width="1" height="8" />
            <rect x="17" width="1" height="8" />
            <rect x="2.6" width="1.8" height="8" opacity=".55" />
            <rect x="6.4" width="1.8" height="8" opacity=".55" />
            <rect x="9.8" width="1.8" height="8" opacity=".55" />
            <rect x="13.6" width="1.8" height="8" opacity=".55" />
          </g>
        </pattern>
        {/* Egg-and-dart moulding (egg.svg), the same band as the titlebar's edge. */}
        <pattern id={eggId} x="36" y="61" width="14" height="10" patternUnits="userSpaceOnUse">
          <g fill="currentColor">
            <rect width="14" height="1" />
            <path
              d="M3 1.8Q3 8.2 7 8.2Q11 8.2 11 1.8"
              fill="none"
              stroke="currentColor"
              strokeWidth=".8"
            />
            <ellipse cx="7" cy="4.6" rx="2.5" ry="2.4" opacity=".5" />
            <path
              d="M0 2C.7 4 .7 5.8 0 7.8C-.7 5.8-.7 4 0 2ZM14 2C14.7 4 14.7 5.8 14 7.8C13.3 5.8 13.3 4 14 2Z"
              opacity=".75"
            />
            <rect y="9" width="14" height="1" />
          </g>
        </pattern>
      </defs>

      {/* Gable, with the app mark in its middle. */}
      <polygon
        points="30,54 220,10 410,54"
        stroke="currentColor"
        strokeWidth="1.4"
        style={{ fill: "color-mix(in oklab, var(--stone-3) 80%, transparent)" }}
      />
      <polygon
        points="64,50 220,18 376,50"
        fill="none"
        stroke="currentColor"
        strokeWidth=".8"
        opacity=".7"
      />
      <g transform="translate(209 26)">
        <BrandMarkIcon size={22} />
      </g>

      {/* Cornice and frieze. */}
      <rect x="30" y="54" width="380" height="6" fill="currentColor" />
      <rect x="36" y="60" width="368" height="12" fill="currentColor" opacity=".15" />
      <rect x="36" y="61" width="368" height="10" fill={`url(#${eggId})`} />

      <Column x={52} shaftFill={`url(#${shaftId})`} />
      <Column x={360} shaftFill={`url(#${shaftId})`} />

      {/* The tablet: an empty ledger. */}
      <rect
        x="96.5"
        y="82.5"
        width="247"
        height="96"
        style={{ fill: "var(--stone-2)", stroke: "var(--line)" }}
      />
      <rect
        x="101.5"
        y="87.5"
        width="237"
        height="86"
        fill="none"
        stroke="currentColor"
        strokeWidth=".8"
        opacity=".6"
      />
      {ROWS.map((row) => (
        <g key={row.numeral}>
          <text
            x="118"
            y={row.y}
            className="pz-display"
            fontSize="11"
            textAnchor="middle"
            fill="currentColor"
          >
            {row.numeral}
          </text>
          <line
            x1="134"
            x2={row.end}
            y1={row.y + 0.5}
            y2={row.y + 0.5}
            strokeWidth="1.2"
            style={{ stroke: "var(--carve)" }}
          />
          <line
            x1="134"
            x2={row.end}
            y1={row.y + 1.6}
            y2={row.y + 1.6}
            style={{ stroke: "var(--carve-edge)" }}
          />
        </g>
      ))}

      {/* Steps. */}
      <rect x="40" y="184" width="360" height="6" fill="currentColor" opacity=".7" />
      <rect x="30" y="190" width="380" height="6" fill="currentColor" />
    </svg>
  );
}
