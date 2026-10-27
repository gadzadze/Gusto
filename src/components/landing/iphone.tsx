import type { ReactNode } from "react";

/**
 * A drawn iPhone around a screen: titanium frame, side buttons, Dynamic Island
 * with its camera, status bar and home indicator. Pure CSS and SVG (no Apple
 * artwork); placement and size come from the className (`phone`, `phone-lg`).
 */
export function IPhone({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={`iphone ${className}`}>
      <span className="ip-btn ip-action" />
      <span className="ip-btn ip-volup" />
      <span className="ip-btn ip-voldn" />
      <span className="ip-btn ip-power" />
      <div className="ip-frame">
        <div className="ip-bezel">
          <div className="ip-screen">
            <div className="ip-status">
              <span className="ip-time">9:41</span>
              <span className="ip-icons">
                <svg
                  width="17"
                  height="11"
                  viewBox="0 0 17 11"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <rect x="0" y="7" width="3" height="4" rx="0.8" />
                  <rect x="4.6" y="5" width="3" height="6" rx="0.8" />
                  <rect x="9.2" y="2.6" width="3" height="8.4" rx="0.8" />
                  <rect x="13.8" y="0" width="3" height="11" rx="0.8" />
                </svg>
                <svg
                  width="15"
                  height="11"
                  viewBox="0 0 15 11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M1 3.6a9.4 9.4 0 0 1 13 0" />
                  <path d="M3.3 6a6.2 6.2 0 0 1 8.4 0" />
                  <path d="M5.6 8.3a3 3 0 0 1 3.8 0" />
                </svg>
                <svg
                  width="25"
                  height="12"
                  viewBox="0 0 25 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect
                    x="0.5"
                    y="0.5"
                    width="21"
                    height="11"
                    rx="3.4"
                    stroke="currentColor"
                    opacity="0.4"
                  />
                  <rect
                    x="2"
                    y="2"
                    width="18"
                    height="8"
                    rx="2.2"
                    fill="currentColor"
                  />
                  <path
                    d="M23 4v4c.9-.3 1.5-1.1 1.5-2S23.900 4.300 23 4Z"
                    fill="currentColor"
                    opacity="0.45"
                  />
                </svg>
              </span>
            </div>
            <span className="ip-island">
              <i />
            </span>
            {children}
            <span className="ip-home" />
          </div>
        </div>
      </div>
    </div>
  );
}
