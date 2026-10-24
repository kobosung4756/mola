import { useCallback, useRef, useState } from 'react';

/**
 * Open/closed state for a side panel that slides out to the right before it goes away.
 * Closing marks the panel (found by `selector`) with .slide-out and only drops it once that
 * animation has played; opening again meanwhile keeps it.
 */
export function useSlidingState<T>(initial: T, closed: T, selector: string): [T, (next: T) => void] {
  const [value, setValue] = useState(initial);
  const seq = useRef(0);
  const set = useCallback(
    (next: T) => {
      const mine = ++seq.current;
      const node = document.querySelector(selector);
      if (next !== closed) {
        node?.classList.remove('slide-out');
        setValue(next);
        return;
      }
      if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setValue(closed);
        return;
      }
      node.classList.add('slide-out');
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (mine === seq.current) setValue(closed);
      };
      node.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 260);
    },
    [closed, selector],
  );
  return [value, set];
}
