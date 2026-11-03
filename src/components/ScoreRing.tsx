import { bandFor, type Band } from "@/lib/scoring";

const STROKE: Record<Band, string> = {
  great: "stroke-green-600",
  good: "stroke-lime-500",
  fair: "stroke-yellow-400",
  poor: "stroke-orange-500",
  avoid: "stroke-red-600",
};

const R = 54;
const C = 2 * Math.PI * R;

/** The overall-score ring: grey track, coloured arc from 12 o'clock, number in the middle. */
export default function ScoreRing({ score, className = "h-32 w-32" }: { score: number; className?: string }) {
  const band = bandFor(score);
  return (
    <svg viewBox="0 0 120 120" className={`${className} shrink-0 -rotate-90`} role="img" aria-label={`Overall score ${score} out of 100`}>
      <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-neutral-200" />
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - score / 100)}
        className={STROKE[band]}
      />
      <text
        x="60"
        y="60"
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90 fill-neutral-900 text-3xl font-semibold"
        style={{ transformOrigin: "60px 60px" }}
      >
        {score}
      </text>
    </svg>
  );
}
