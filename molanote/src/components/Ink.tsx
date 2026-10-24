import type { Stroke } from '../types';
import { HIGHLIGHT_FACTOR, HIGHLIGHT_OPACITY, strokeD } from '../draw';

/** Strokes in a drawing space of the given size, stretched to fill their box. */
export function InkLayer({
  strokes,
  width,
  height,
  className,
}: {
  strokes: Stroke[];
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <svg
      className={['ink', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {strokes.map((s) => (
        <path
          key={s.id}
          d={strokeD(s.points)}
          fill="none"
          stroke={s.color}
          strokeWidth={s.tool === 'highlighter' ? s.size * HIGHLIGHT_FACTOR : s.size}
          strokeOpacity={s.tool === 'highlighter' ? HIGHLIGHT_OPACITY : 1}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-tool={s.tool}
        />
      ))}
    </svg>
  );
}
