import type { Content, LineStyle, LineWeight } from '../types';
import { COLORS, dashFor, LINE_WEIGHTS } from '../types';
import { tr } from '../i18n';

export interface LineLook {
  content: Pick<Content, 'lineStyle' | 'weight' | 'arrow' | 'arrowStart'>;
  color?: string;
}

export interface LinePatch {
  content?: LineLook['content'];
  /** `null` clears the colour. */
  color?: string | null;
}

const STYLES: { value: LineStyle; label: string }[] = [
  { value: 'solid', label: tr('실선', 'Solid') },
  { value: 'dashed', label: tr('파선', 'Dashed') },
  { value: 'dotted', label: tr('점선', 'Dotted') },
];

const WEIGHTS: { value: LineWeight; label: string }[] = [
  { value: 'thin', label: tr('얇게', 'Thin') },
  { value: 'normal', label: tr('보통', 'Normal') },
  { value: 'thick', label: tr('굵게', 'Thick') },
];

type ArrowMode = 'none' | 'end' | 'both';
const ARROWS: { value: ArrowMode; label: string }[] = [
  { value: 'none', label: tr('화살표 없음', 'No arrows') },
  { value: 'end', label: tr('한쪽 화살표', 'One arrow') },
  { value: 'both', label: tr('양쪽 화살표', 'Both arrows') },
];

const arrowModeOf = (c: LineLook['content']): ArrowMode =>
  c.arrow && c.arrowStart ? 'both' : c.arrow || c.arrowStart ? 'end' : 'none';

/** Picker for line style, thickness, arrowheads and colour. */
export function LineControls({ look, onChange }: { look: LineLook; onChange: (patch: LinePatch) => void }) {
  const style = look.content.lineStyle ?? 'solid';
  const weight = look.content.weight ?? 'normal';
  const arrows = arrowModeOf(look.content);
  const stroke = look.color ? COLORS[look.color] : '#5f5c57';

  const preview = (s: LineStyle, w: LineWeight, mode: ArrowMode = 'none') => {
    const sw = LINE_WEIGHTS[w];
    return (
      <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
        {mode !== 'none' && (
          <defs>
            <marker id={`pv-${s}-${w}-${mode}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={stroke} />
            </marker>
          </defs>
        )}
        <line
          x1="4"
          y1="7"
          x2="30"
          y2="7"
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dashFor(s, sw)}
          strokeLinecap={s === 'dotted' ? 'round' : 'butt'}
          markerEnd={mode !== 'none' ? `url(#pv-${s}-${w}-${mode})` : undefined}
          markerStart={mode === 'both' ? `url(#pv-${s}-${w}-${mode})` : undefined}
        />
      </svg>
    );
  };

  return (
    <div className="line-controls">
      <div className="seg" role="group" aria-label={tr('선 모양', 'Line style')}>
        {STYLES.map((s) => (
          <button
            key={s.value}
            className={style === s.value ? 'on' : ''}
            title={s.label}
            aria-pressed={style === s.value}
            data-line-style-btn={s.value}
            onClick={() => onChange({ content: { lineStyle: s.value } })}
          >
            {preview(s.value, 'normal')}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label={tr('선 굵기', 'Line weight')}>
        {WEIGHTS.map((w) => (
          <button
            key={w.value}
            className={weight === w.value ? 'on' : ''}
            title={w.label}
            aria-pressed={weight === w.value}
            onClick={() => onChange({ content: { weight: w.value } })}
          >
            {preview('solid', w.value)}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label={tr('화살표', 'Arrows')}>
        {ARROWS.map((a) => (
          <button
            key={a.value}
            className={arrows === a.value ? 'on' : ''}
            title={a.label}
            aria-pressed={arrows === a.value}
            onClick={() =>
              onChange({ content: { arrow: a.value !== 'none', arrowStart: a.value === 'both' } })
            }
          >
            {preview('solid', 'normal', a.value)}
          </button>
        ))}
      </div>
      <div className="colors">
        <button className={`dot none${!look.color ? ' on' : ''}`} title={tr('기본 색', 'Default color')} onClick={() => onChange({ color: null })} />
        {Object.entries(COLORS).map(([name, hex]) => (
          <button
            key={name}
            className={`dot${look.color === name ? ' on' : ''}`}
            style={{ background: hex }}
            title={name}
            onClick={() => onChange({ color: name })}
          />
        ))}
      </div>
    </div>
  );
}
