import { useId } from "react";

// Small SVG flags. Emoji flags would show up as the letters "GE" / "GB" on Windows, so these are drawn.

/** Georgia: the white field with a large red cross and four small ones. */
export function FlagGE({ className }: { className?: string }) {
  const small = (cx: number, cy: number) => (
    <g key={`${cx}-${cy}`} fill="#d1141a">
      <rect x={cx - 1.7} y={cy - 0.55} width="3.4" height="1.1" />
      <rect x={cx - 0.55} y={cy - 1.7} width="1.1" height="3.4" />
    </g>
  );
  return (
    <svg viewBox="0 0 30 20" aria-hidden className={className} focusable="false">
      <rect width="30" height="20" fill="#fff" />
      <rect x="12.5" width="5" height="20" fill="#d1141a" />
      <rect y="7.5" width="30" height="5" fill="#d1141a" />
      {[small(6.25, 3.75), small(23.75, 3.75), small(6.25, 16.25), small(23.75, 16.25)]}
    </svg>
  );
}

/** The United Kingdom's Union Jack, cropped to the same box as the other flag. */
export function FlagGB({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden className={className} focusable="false">
      <clipPath id={`${id}s`}>
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id={`${id}t`}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath={`url(#${id}s)`}>
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${id}t)`} stroke="#c8102e" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
      </g>
    </svg>
  );
}
