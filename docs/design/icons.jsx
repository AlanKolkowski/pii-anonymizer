// Icons — minimal, line-based
const Icon = ({ name, size = 14, ...rest }) => {
  const s = size;
  const common = { width: s, height: s, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', ...rest };
  switch (name) {
    case 'shield':
      return <svg {...common}><path d="M8 1.5 2.5 3.5v4c0 3.5 2.5 6 5.5 7 3-1 5.5-3.5 5.5-7v-4L8 1.5Z"/></svg>;
    case 'lock':
      return <svg {...common}><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>;
    case 'cpu':
      return <svg {...common}><rect x="4" y="4" width="8" height="8" rx="1"/><path d="M2 6h2M2 10h2M12 6h2M12 10h2M6 2v2M10 2v2M6 12v2M10 12v2"/></svg>;
    case 'plug':
      return <svg {...common}><path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0V5ZM8 12v3"/></svg>;
    case 'play':
      return <svg {...common}><path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor"/></svg>;
    case 'arrow-right':
      return <svg {...common}><path d="M3 8h10M9 4l4 4-4 4"/></svg>;
    case 'arrow-down':
      return <svg {...common}><path d="M8 3v10M4 9l4 4 4-4"/></svg>;
    case 'plus':
      return <svg {...common}><path d="M8 3v10M3 8h10"/></svg>;
    case 'x':
      return <svg {...common}><path d="M4 4l8 8M12 4l-8 8"/></svg>;
    case 'check':
      return <svg {...common}><path d="M3 8l3.5 3.5L13 5"/></svg>;
    case 'doc':
      return <svg {...common}><path d="M4 1.5h5l3 3v10h-8v-13Z"/><path d="M9 1.5v3h3"/></svg>;
    case 'paste':
      return <svg {...common}><rect x="4" y="3" width="8" height="11" rx="1"/><path d="M6 3V2h4v1M6 7h4M6 10h4"/></svg>;
    case 'upload':
      return <svg {...common}><path d="M8 10V2M5 5l3-3 3 3M2 13h12"/></svg>;
    case 'edit':
      return <svg {...common}><path d="M11 2.5l2.5 2.5L6 12.5H3.5V10L11 2.5Z"/></svg>;
    case 'copy':
      return <svg {...common}><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/></svg>;
    case 'chevron':
      return <svg {...common}><path d="M5 3l5 5-5 5"/></svg>;
    case 'sparkle':
      return <svg {...common}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2"/></svg>;
    case 'zap':
      return <svg {...common}><path d="M9 1L3 9h4l-1 6 6-8H8l1-6Z"/></svg>;
    case 'globe':
      return <svg {...common}><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>;
    case 'eye-off':
      return <svg {...common}><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4ZM2 2l12 12"/></svg>;
    case 'gear':
      return <svg {...common}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8 3.4 3.4"/></svg>;
    case 'github':
      return <svg {...common}><path d="M8 1.5a6.5 6.5 0 0 0-2 12.7c.3.1.4-.1.4-.3v-1.2c-1.8.4-2.2-.8-2.2-.8-.3-.7-.7-1-.7-1-.6-.4 0-.4 0-.4.7 0 1 .7 1 .7.6 1 1.6.7 2 .6 0-.5.2-.8.4-1-1.4-.2-2.9-.7-2.9-3.2 0-.7.3-1.3.7-1.7 0-.2-.3-.9.1-1.8 0 0 .6-.2 1.8.7a6 6 0 0 1 3.2 0c1.2-.9 1.8-.7 1.8-.7.4.9.1 1.6.1 1.8.4.4.7 1 .7 1.7 0 2.5-1.5 3-2.9 3.2.2.2.4.6.4 1.2v1.8c0 .2.1.4.4.3A6.5 6.5 0 0 0 8 1.5Z"/></svg>;
    case 'file-text':
      return <svg {...common}><path d="M4 1.5h5l3 3v10h-8v-13Z"/><path d="M6 7h4M6 10h4M6 13h2"/></svg>;
    case 'tag':
      return <svg {...common}><path d="M2 2h6l6 6-6 6-6-6V2Z"/><circle cx="5" cy="5" r="0.8" fill="currentColor"/></svg>;
    default:
      return null;
  }
};

window.Icon = Icon;
