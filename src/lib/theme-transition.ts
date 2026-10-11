/**
 * Theme switch reveal, as on boardui.com: a small circle opens from the top
 * centre of the screen and grows until the new theme covers the whole page.
 *
 * Uses the View Transitions API: the browser snapshots the old theme, `update`
 * applies the new one, and the new snapshot is clipped by an expanding circle.
 * Browsers without the API, and visitors who prefer reduced motion, get an
 * instant switch.
 */
export function runThemeTransition(update: () => void) {
  if (typeof document === "undefined" || !document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const root = document.documentElement;
  // Freeze component colour transitions so the circle reveals the final palette.
  root.classList.add("theme-transitioning");
  const transition = document.startViewTransition(update);
  transition.ready
    .then(() => {
      const x = window.innerWidth / 2;
      const y = 0;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), window.innerHeight - y);
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => undefined);
  // A rapid second toggle or a navigation aborts the transition; the theme is still applied.
  transition.finished.catch(() => undefined).finally(() => root.classList.remove("theme-transitioning"));
}
