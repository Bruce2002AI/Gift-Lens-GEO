"use client";

interface CompletionRingProps {
  /** Completion percentage, 0–100. Values outside the range are clamped. */
  value: number;
  /** Outer diameter in px. */
  size?: number;
  /** Caption under the percentage, e.g. the lens name. */
  label?: string;
}

/**
 * A donut showing how much of a lens's profile is filled in.
 *
 * Purely informational — nothing in the product is gated on reaching 100%, so
 * the ring never uses alarm colours or urgency language.
 */
export function CompletionRing({ value, size = 88, label }: CompletionRingProps) {
  const pct = Math.round(
    Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0)),
  );

  const stroke = Math.max(6, Math.round(size * 0.1));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // stroke-dasharray draws `dash` of ink then leaves the remainder blank.
  const dash = (pct / 100) * circumference;
  const center = size / 2;

  return (
    <div
      className="inline-flex flex-col items-center gap-1"
      role="img"
      aria-label={
        label
          ? `${label} profile ${pct} percent complete`
          : `Profile ${pct} percent complete`
      }
    >
      <span className="relative inline-flex" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
          focusable="false"
        >
          {/* Track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-sand)"
            strokeWidth={stroke}
          />
          {/* Progress — rotated so it starts at 12 o'clock. */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-plum)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(-90 ${center} ${center})`}
            className="transition-[stroke-dasharray] duration-500 ease-out"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-(family-name:--font-display) font-semibold text-ink"
            style={{ fontSize: Math.max(14, Math.round(size * 0.26)) }}
          >
            {pct}%
          </span>
        </span>
      </span>
      {label && (
        <span className="text-xs tracking-wide text-ink-soft uppercase">{label}</span>
      )}
    </div>
  );
}
