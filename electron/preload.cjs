// Preload (sandboxed, CommonJS). The ONLY bridge between renderer and main.
// Exposes a single frozen object with one read-only diagnostic call — no raw
// ipcRenderer, no dynamic channel names, no send/on. See SECURITY.md §4.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Remove the WebRTC constructors from the page's main world before any page
// script runs (SECURITY.md §3). This is defence in depth, not the primary
// control — a fresh realm (about:blank iframe) still exposes them, which is why
// the real block is setWebRTCIPHandlingPolicy('disable_non_proxied_udp') in
// electron/main.mjs. Nothing in this app uses WebRTC; feature detection sees
// `undefined` rather than a throwing getter, so no library misbehaves.
webFrame.executeJavaScript(`
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'RTCDataChannel']) {
    try {
      delete window[name];
      Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false });
    } catch {}
  }
`);

contextBridge.exposeInMainWorld('desktopApp', Object.freeze({
  /** True in the desktop build; the web app sees undefined. */
  isDesktop: true,
  /** App version + Electron/Chromium versions + network-block counters. */
  getInfo: () => ipcRenderer.invoke('pii:desktop-info'),
}));
