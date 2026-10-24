/**
 * Built in only by the double-click launcher (VITE_BOARD_AUTO_EXIT=1): tells the local server this
 * tab is open, and says goodbye when it closes, so the server can stop once no tab is left.
 */
export function keepServerAlive() {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random()).slice(2);
  const ping = () => {
    fetch(`/__board_alive?id=${id}`, { cache: 'no-store' }).catch(() => {});
  };
  ping();
  setInterval(ping, 20_000);
  addEventListener('pagehide', () => navigator.sendBeacon(`/__board_alive?id=${id}&bye`));
  // Coming back from the back/forward cache counts as opening again.
  addEventListener('pageshow', (e) => {
    if (e.persisted) ping();
  });
}
