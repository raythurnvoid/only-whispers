// The control panel logo: the app name on one line, centered over a small
// laurel crown (two branches crossing at the bottom, open at the top).
import { buildLaurelBranch, LaurelBranch } from "./laurel";

const W = 180;

const BRANCH = buildLaurelBranch({
  cx: 90,
  cy: 30,
  rx: 29,
  ry: 24,
  endDeg: 235,
  stemStartDeg: 80,
  firstStep: 3,
  step: 4.6,
  endGap: 4,
  leafLen: 6,
  leafW: 2.2,
  falloff: 0.35,
  tipSize: 0.7,
  berryOffset: 3,
});

export default function LaurelLogo() {
  return (
    <div className="relative mx-2 mt-1 mb-[18px] grid h-[60px] place-items-center">
      <svg
        viewBox={`0 0 ${W} 60`}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full text-(--laurel)"
      >
        <LaurelBranch branch={BRANCH} stemWidth={1.1} berryRadius={1.05} />
        <LaurelBranch branch={BRANCH} stemWidth={1.1} berryRadius={1.05} mirrorAt={W} />
      </svg>
      {/* The name sits on a strip of the window's own marble (both fixed, so they
          line up): it hides the leaves behind the letters and is otherwise unseen. */}
      <div className="pz-window pz-display relative whitespace-nowrap px-2 pt-[3px] pb-px text-[12.5px] font-semibold tracking-[0.12em] text-foreground uppercase">
        Only Whispers
      </div>
    </div>
  );
}
