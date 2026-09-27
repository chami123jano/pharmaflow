/**
 * The pharmacy mark: a cross, a pulse and a capsule.
 *
 * Deliberately generic rather than tied to one shop — the same mark suits the
 * product and any pharmacy running it, which is what keeps a single codebase
 * serving both. The shop's own name sits beside it, not inside it.
 *
 * Drawn with one beat instead of the three a busier logo would use: at 24px in
 * a header, three collapse into a smudge. The geometry is duplicated in
 * `scripts/icons.mjs`, which rasterises it for the home screen — a phone will
 * not take an SVG. If this changes, change that too.
 */

const NAVY = '#1d3b6e';
const TEAL = '#17a3a3';
const LIME = '#7cc242';

const CROSS =
  'M25 7h14a3 3 0 0 1 3 3v12h12a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H42v12a3 3 0 0 1-3 3H25a3 3 0 0 1-3-3V42H10a3 3 0 0 1-3-3V25a3 3 0 0 1 3-3h12V10a3 3 0 0 1 3-3z';
const TRACE = 'M4 32h17l3-10 4 19 4-13 3 4h25';

export default function Logo({
  size = 40,
  tile = true,
  className = '',
}: {
  size?: number;
  /** The white rounded backing, so the mark holds up on a dark header too. */
  tile?: boolean;
  className?: string;
}) {
  // Unique per instance: two logos on one page must not share a clip id.
  const id = `cross-${size}-${tile ? 't' : 'n'}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Pharmacy"
    >
      <defs>
        <clipPath id={id}>
          <path d={CROSS} />
        </clipPath>
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

      <path d={TRACE} fill="none" stroke="#ffffff" strokeWidth="8.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={TRACE} fill="none" stroke={LIME} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
