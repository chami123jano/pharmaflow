/**
 * The app's mark.
 *
 * Two are shipped and a setting picks one, for the same reason the shop's name
 * is a setting: one codebase serves both a named pharmacy and the public
 * release, and hardcoding either forks the source.
 *
 *  - `capsule` — a capsule curved until the gap makes a C, a pulse inside it.
 *    A pharmacy sign and an initial at once.
 *  - `cross`   — a plain cross, pulse and capsule. The neutral default, with
 *    nothing belonging to any one shop in it.
 *
 * The same geometry is rasterised in `web/scripts/icons.mjs` (phone icons) and
 * `app-desktop/scripts/make-icon.mjs` (the Windows .ico), because neither a
 * home screen nor a taskbar will take an SVG. Change one, change all three.
 */

const NAVY = '#12385f';
const TEAL = '#0e9da0';
const LIME = '#8bc53f';

export type Mark = 'capsule' | 'cross';

/**
 * The capsule is two arcs rather than one dashed path, so the seam between the
 * halves lands exactly on the left edge — where the join line of a real
 * capsule has to sit. A dash offset put it a few degrees out, which read as a
 * mistake rather than a detail.
 */
const CAP_TOP = 'M46 17.5A21 21 0 0 0 11 32';
const CAP_BOTTOM = 'M11 32A21 21 0 0 0 46 46.5';
const CAP_PULSE = 'M23 32h5.5l2.5-7.5 3.5 15 2.5-7.5H43';

const CROSS =
  'M25 7h14a3 3 0 0 1 3 3v12h12a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H42v12a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3V42H10a3 3 0 0 1-3-3V25a3 3 0 0 1 3-3h12V10a3 3 0 0 1 3-3z';
const CROSS_TRACE = 'M4 32h17l3-10 4 19 4-13 3 4h25';

export default function Logo({
  size = 40,
  mark = 'capsule',
  tile = true,
  className = '',
}: {
  size?: number;
  mark?: Mark;
  /** The rounded backing, so the mark holds up on a dark header too. */
  tile?: boolean;
  className?: string;
}) {
  // Unique per instance: two logos on one page must not share a clip id.
  const id = `lg-${mark}-${size}`;

  if (mark === 'cross') {
    return (
      <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="Pharmacy">
        <defs>
          <clipPath id={id}><path d={CROSS} /></clipPath>
        </defs>
        {tile && <rect width="64" height="64" rx="15" fill="#ffffff" />}
        <g clipPath={`url(#${id})`}>
          <path d={CROSS} fill={NAVY} />
          <path d="M64 6 64 64 6 64Z" fill={TEAL} />
        </g>
        <g transform="rotate(-45 47 17)">
          <rect x="37" y="11" width="20" height="12" rx="6" fill={LIME} />
          <path d="M47 11v12" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <path d={CROSS_TRACE} fill="none" stroke="#ffffff" strokeWidth="8.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={CROSS_TRACE} fill="none" stroke={LIME} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="Pharmacy">
      {tile && <rect width="64" height="64" rx="15" fill="#ffffff" />}
      <g fill="none" strokeWidth="9.5" strokeLinecap="round">
        <path d={CAP_TOP} stroke={NAVY} />
        <path d={CAP_BOTTOM} stroke={TEAL} />
      </g>
      {/* the seam of the capsule, on the left edge where the halves meet */}
      <path d="M6.6 32h8.8" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
      <path d={CAP_PULSE} fill="none" stroke={LIME} strokeWidth="4.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
