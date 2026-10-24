import type { ReactNode } from 'react';

/** Simple line icons drawn on a 24×24 grid in the current text colour (dark grey by default). */
const PATHS: Record<string, ReactNode> = {
  note: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </>
  ),
  todo: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 12.2l2.8 2.8L16 9.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-5.5-5L5 19" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  column: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
      <path d="M4.5 7.5h15" />
      <rect x="7.5" y="10" width="9" height="3.5" rx="1" strokeWidth="1.17" />
      <rect x="7.5" y="15.5" width="9" height="3" rx="1" strokeWidth="1.17" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  swatch: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.6-.7 1.6-1.5 0-.45-.2-.8-.5-1.15-.3-.35-.5-.7-.5-1.15 0-.85.7-1.5 1.5-1.5h1.9a4.5 4.5 0 0 0 4.5-4.5c0-4-3.8-7.2-8.5-7.2z" />
      <circle cx="7.6" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="7.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="7.6" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  diagram: (
    <>
      <rect x="3" y="4" width="8" height="6" rx="1.6" />
      <rect x="13" y="14" width="8" height="6" rx="1.6" />
      <path d="M7 10v4.5a2 2 0 002 2h4" />
      <path d="M11.5 15l1.6 1.5-1.6 1.5" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M3 14.5h18M9 9.5V20M15 9.5V20" />
    </>
  ),
  line: (
    <>
      <path d="M5 19L15.5 8.5" />
      <path d="M20 4l-2.2 8-5.8-5.8z" fill="currentColor" strokeWidth="1.24" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10.2 11v5.5M13.8 11v5.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a5.5 5.5 0 0 1 0 11h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a5.5 5.5 0 0 0 0 11h3" />
    </>
  ),
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  constellation: (
    <>
      <path d="M6 7l6 4 6-5M12 11l-3 7M12 11l6 6" />
      <circle cx="6" cy="7" r="1.8" fill="currentColor" />
      <circle cx="12" cy="11" r="2.2" fill="currentColor" />
      <circle cx="18" cy="6" r="1.5" fill="currentColor" />
      <circle cx="9" cy="18" r="1.5" fill="currentColor" />
      <circle cx="18" cy="17" r="1.8" fill="currentColor" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <circle cx="9.2" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  title: <path d="M5 7V4.5h14V7M12 4.5V20M9 20h6" />,
  comment: <path d="M5.5 4.5h13a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V6a1.5 1.5 0 0 1 1.5-1.5z" />,
  caption: (
    <>
      <rect x="3" y="4" width="18" height="11" rx="2" />
      <path d="M6 19h12" />
    </>
  ),
  rename: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  tableSize: (
    <>
      <rect x="3.5" y="3.5" width="12" height="12" rx="1.5" />
      <path d="M3.5 9.5h12M9.5 3.5v12M14 20.5h6.5V14M20.5 20.5l-5-5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.5h.01M18 12.5h.01M8.5 15h7" />
      <path d="M9.5 12.5h5" />
    </>
  ),
  lineLabel: (
    <>
      <rect x="3.5" y="7" width="17" height="10" rx="3.5" />
      <path d="M8 12h8" />
    </>
  ),
  math: (
    <>
      <path d="M3 12.5h2.5l3 6.5L13.5 4.5H21" />
      <path d="M15 11l5 6M20 11l-5 6" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5-8.5 8.5z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  arrowStart: <path d="M5.5 5v14M19 12H9M13 8l-4 4 4 4" />,
  arrowEnd: <path d="M18.5 5v14M5 12h10M11 8l4 4-4 4" />,
  dashed: <path d="M3 12h3.5M10.25 12h3.5M17.5 12H21" />,
  weight: (
    <>
      <path d="M4 6.5h16" strokeWidth="0.93" />
      <path d="M4 12h16" strokeWidth="1.71" />
      <path d="M4 17.5h16" strokeWidth="2.64" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 6.6-1.6" />
    </>
  ),
  front: (
    <>
      <rect x="3.5" y="3.5" width="10" height="10" rx="2" strokeDasharray="2.5 2.5" />
      <rect x="10.5" y="10.5" width="10" height="10" rx="2" fill="currentColor" fillOpacity="0.18" />
    </>
  ),
  back: (
    <>
      <rect x="10.5" y="10.5" width="10" height="10" rx="2" strokeDasharray="2.5 2.5" />
      <rect x="3.5" y="3.5" width="10" height="10" rx="2" fill="currentColor" fillOpacity="0.18" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  grip: <path d="M5 8h14M5 12h14M5 16h14" />,
  pen: (
    <>
      <path d="M4.5 19.5l1-4.2L16.3 4.5a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5L8.7 18.5z" />
      <path d="M14.5 6.3l3.2 3.2" />
    </>
  ),
  highlighter: <path d="M9 14l-5 6h6l2-2M9 14l7-10 4 3-7 10zM9 14l4 3" />,
  eraser: (
    <>
      <path d="M8.5 20.5h11" />
      <path d="M5.2 15.8l9.3-9.3a1.8 1.8 0 0 1 2.5 0l2.5 2.5a1.8 1.8 0 0 1 0 2.5L12 19H8.4z" />
      <path d="M9.5 11.5l5 5" />
    </>
  ),
  // Lasso: a dashed loop with its tail.
  lasso: (
    <>
      <path d="M12 4.5c4.7 0 8.5 2.3 8.5 5.2s-3.8 5.2-8.5 5.2-8.5-2.3-8.5-5.2S7.3 4.5 12 4.5z" strokeDasharray="2.6 2.2" />
      <path d="M7.5 14.2c-.9 1.4-.6 3 .8 3.6 1.2.5 1.7 1.6 1.2 2.7" />
    </>
  ),
  crop: <path d="M6.5 2.5v13a2 2 0 0 0 2 2h13M17.5 21.5v-13a2 2 0 0 0-2-2h-13" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  home: (
    <>
      <path d="M4 10.5L12 4l8 6.5" />
      <path d="M6 9v10.5h12V9" />
      <path d="M10 19.5v-5h4v5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" />,
  down: <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  rowPlus: (
    <>
      <rect x="3.5" y="4" width="17" height="6" rx="1.5" />
      <path d="M12 13.5v7M8.5 17h7" />
    </>
  ),
  rowMinus: (
    <>
      <rect x="3.5" y="4" width="17" height="6" rx="1.5" />
      <path d="M8.5 17h7" />
    </>
  ),
  colPlus: (
    <>
      <rect x="4" y="3.5" width="6" height="17" rx="1.5" />
      <path d="M17 8.5v7M13.5 12h7" />
    </>
  ),
  colMinus: (
    <>
      <rect x="4" y="3.5" width="6" height="17" rx="1.5" />
      <path d="M13.5 12h7" />
    </>
  ),
  comma: (
    <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
      1,0
    </text>
  ),
  decInc: (
    <>
      <text x="2" y="13" fontSize="9" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
        .0
      </text>
      <path d="M13 9h8M17 5v8" />
      <path d="M4 19h12" strokeWidth="1.09" />
    </>
  ),
  decDec: (
    <>
      <text x="2" y="13" fontSize="9" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">
        .0
      </text>
      <path d="M13 9h8" />
      <path d="M4 19h12" strokeWidth="1.09" />
    </>
  ),
  // Text colour: a blue letter (a fixed colour, not the grey ink).
  textColor: <path d="M6.5 19L12 5l5.5 14M8.6 13.8h6.8" stroke="#1971c2" strokeWidth="1.85" />,
  // Text style: a blue letter on a yellow highlight (fixed colours, not the grey ink).
  textStyle: (
    <>
      <rect x="3" y="13" width="18" height="7.5" rx="1.5" fill="#ffe066" stroke="none" />
      <path d="M6.5 18.5L12 4.5l5.5 14M8.6 13.3h6.8" stroke="#1971c2" strokeWidth="1.71" />
    </>
  ),
  underline: <path d="M7 4.5v7a5 5 0 0 0 10 0v-7M5.5 20h13" />,
  h1: (
    <>
      <path d="M4 6v12M12 6v12M4 12h8" />
      <path d="M16.5 9.5L19 7.5V18" />
    </>
  ),
  h2: (
    <>
      <path d="M3.5 6v12M11 6v12M3.5 12H11" />
      <path d="M14.5 9a2.6 2.6 0 0 1 5 1c0 2.2-5 4.5-5 8h5.2" />
    </>
  ),
  h3: (
    <>
      <path d="M3.5 6v12M11 6v12M3.5 12H11" />
      <path d="M14.8 8.2a2.5 2.5 0 0 1 4.6 1.2c0 1.4-1.2 2.2-2.6 2.2 1.6 0 2.9.9 2.9 2.5a2.6 2.6 0 0 1-4.9 1.2" />
    </>
  ),
  checklist: (
    <>
      <rect x="3" y="4.5" width="5.5" height="5.5" rx="1.2" />
      <path d="M4.4 7.3l1.1 1.1 2-2.2" strokeWidth="1.09" />
      <rect x="3" y="14" width="5.5" height="5.5" rx="1.2" />
      <path d="M12 7.3h8.5M12 16.8h8.5" />
    </>
  ),
  toggle: (
    <>
      <path d="M4 5.5l4.5 3-4.5 3z" fill="currentColor" stroke="none" />
      <path d="M11.5 8.5h9M11.5 14h9M11.5 18.5h6" />
    </>
  ),
  codeBlock: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5" />
    </>
  ),
  divider: (
    <>
      <path d="M3.5 12h17" />
      <path d="M6 7h12M6 17h12" strokeWidth="0.93" opacity="0.45" />
    </>
  ),
  paragraph: <path d="M13 5v15M17 5v15M19.5 5H10a4 4 0 0 0 0 8h3" />,
  listBullet: (
    <>
      <circle cx="5" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9.5 7H20M9.5 12H20M9.5 17H20" />
    </>
  ),
  listNumber: (
    <>
      <path d="M10 7h10M10 12h10M10 17h10" />
      <path d="M4 5.5l1.5-1v4.5M3.8 14.3a1.4 1.4 0 0 1 2.6.6c0 1-2.6 2-2.6 3.6h2.8" strokeWidth="1.09" />
    </>
  ),
  quote: (
    <>
      <path d="M5 4.5v15" strokeWidth="1.87" />
      <path d="M10 8h10M10 12h10M10 16h6" />
    </>
  ),
  code: <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" />,
  bold: (
    <path
      d="M6.5 4h6.8a4 4 0 0 1 2.6 7.05A4.3 4.3 0 0 1 13.9 20H6.5zM9.8 7v3.6h3.1a1.8 1.8 0 0 0 0-3.6zm0 6.3V17h3.6a1.85 1.85 0 0 0 0-3.7z"
      fill="currentColor"
      stroke="none"
      fillRule="evenodd"
    />
  ),
  italic: <path d="M10 5h8M6 19h8M14.5 5l-5 14" />,
  strike: (
    <>
      <path d="M4.5 12h15" />
      <path d="M16.5 7.5c-.6-1.7-2.3-2.8-4.5-2.8-2.6 0-4.4 1.4-4.4 3.3 0 1.5.9 2.4 2.6 3" />
      <path d="M8 16.5c.6 1.8 2.3 2.8 4.4 2.8 2.7 0 4.6-1.4 4.6-3.4 0-.9-.3-1.6-.9-2.2" />
    </>
  ),
  align: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M7.5 9h9M7.5 12h5.5M7.5 15h9" />
    </>
  ),
  alignLeft: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  objLeft: (
    <>
      <path d="M4 3v18" />
      <rect x="7" y="6" width="12" height="4.5" rx="1" />
      <rect x="7" y="13.5" width="7" height="4.5" rx="1" />
    </>
  ),
  objCenter: (
    <>
      <path d="M12 3v3M12 10.5v3M12 18v3" />
      <rect x="5" y="6" width="14" height="4.5" rx="1" />
      <rect x="8" y="13.5" width="8" height="4.5" rx="1" />
    </>
  ),
  objRight: (
    <>
      <path d="M20 3v18" />
      <rect x="5" y="6" width="12" height="4.5" rx="1" />
      <rect x="10" y="13.5" width="7" height="4.5" rx="1" />
    </>
  ),
  objTop: (
    <>
      <path d="M3 4h18" />
      <rect x="6" y="7" width="4.5" height="12" rx="1" />
      <rect x="13.5" y="7" width="4.5" height="7" rx="1" />
    </>
  ),
  objMiddle: (
    <>
      <path d="M3 12h3M10.5 12h3M18 12h3" />
      <rect x="6" y="5" width="4.5" height="14" rx="1" />
      <rect x="13.5" y="8" width="4.5" height="8" rx="1" />
    </>
  ),
  objBottom: (
    <>
      <path d="M3 20h18" />
      <rect x="6" y="5" width="4.5" height="12" rx="1" />
      <rect x="13.5" y="10" width="4.5" height="7" rx="1" />
    </>
  ),
  distH: (
    <>
      <path d="M3.5 4v16M20.5 4v16" />
      <rect x="9.75" y="7" width="4.5" height="10" rx="1" />
    </>
  ),
  distV: (
    <>
      <path d="M4 3.5h16M4 20.5h16" />
      <rect x="7" y="9.75" width="10" height="4.5" rx="1" />
    </>
  ),
  alignCenter: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  alignRight: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  alignTop: (
    <>
      <path d="M4 4h16" />
      <rect x="8" y="7" width="8" height="9" rx="1.5" />
    </>
  ),
  alignMiddle: (
    <>
      <path d="M3.5 12H8M16 12h4.5" />
      <rect x="8" y="7.5" width="8" height="9" rx="1.5" />
    </>
  ),
  alignBottom: (
    <>
      <path d="M4 20h16" />
      <rect x="8" y="8" width="8" height="9" rx="1.5" />
    </>
  ),
  fill: (
    <>
      <path d="M5.2 11.2L11 5.4l7 7-5.8 5.8a2 2 0 0 1-2.8 0l-4.2-4.2a2 2 0 0 1 0-2.8z" />
      <path d="M5 12.5h12.6M8.5 3l2.5 2.4" />
      <path d="M19.8 15.6s1.6 1.9 1.6 3a1.6 1.6 0 0 1-3.2 0c0-1.1 1.6-3 1.6-3z" />
    </>
  ),
  cellType: <path d="M9.5 4L7.5 20M16.5 4l-2 16M4.5 9h15.5M3.8 15h15.5" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  /** Filled versions for the left bar's foot (settings and trash), drawn in grey there. */
  settingsFilled: (
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z M15.2 12a3.2 3.2 0 1 0-6.4 0 3.2 3.2 0 1 0 6.4 0z" fill="currentColor" stroke="none" fillRule="evenodd" />
  ),
  // Tool order: arrows up and down beside three bars (filled, like the trash beside it).
  reorderFilled: (
    <>
      <path d="M6 3.2l3.6 4.3H7.2v9H4.8v-9H2.4z" fill="currentColor" stroke="none" />
      <path d="M6 20.8l-3.6-4.3h2.4v-4h2.4v4h2.4z" fill="currentColor" stroke="none" opacity="0.55" />
      <rect x="12" y="5" width="9.6" height="2.8" rx="1.4" fill="currentColor" stroke="none" />
      <rect x="12" y="10.6" width="9.6" height="2.8" rx="1.4" fill="currentColor" stroke="none" />
      <rect x="12" y="16.2" width="9.6" height="2.8" rx="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  trashFilled: (
    <>
      <path d="M9 3.2h6a1 1 0 0 1 1 1V5.5h3.6a1 1 0 0 1 0 2H4.4a1 1 0 0 1 0-2H8V4.2a1 1 0 0 1 1-1z" fill="currentColor" stroke="none" />
      <path
        d="M5.6 9h12.8l-.9 10.8A2 2 0 0 1 15.5 21.6h-7a2 2 0 0 1-2-1.8zM9.6 11.4a.8.8 0 0 0-.8.8v5.6a.8.8 0 0 0 1.6 0v-5.6a.8.8 0 0 0-.8-.8zm4.8 0a.8.8 0 0 0-.8.8v5.6a.8.8 0 0 0 1.6 0v-5.6a.8.8 0 0 0-.8-.8z"
        fill="currentColor"
        stroke="none"
        fillRule="evenodd"
      />
    </>
  ),
  cloud: <path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6-1.3A4.7 4.7 0 0 0 7 18.5z" />,
  folder: <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  drive: (
    <>
      <rect x="3" y="13" width="18" height="6" rx="1.6" />
      <path d="M5 13l2.2-7h9.6L19 13M16.5 16h.01" />
    </>
  ),
  // A linked copy: two arrows passing each other.
  exchange: <path d="M4 8.5h14l-3.5-3.5M20 15.5H6l3.5 3.5" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 17.2v.01" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 2.8 19.5h18.4z" />
      <path d="M12 10v4.2M12 17v.01" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      data-tip={title}
      data-icon={name}
    >
      {PATHS[name]}
    </svg>
  );
}
