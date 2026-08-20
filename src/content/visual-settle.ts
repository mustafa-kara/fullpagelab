function waitForPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function waitForVisualSettle(): Promise<void> {
  // Flush the visibility/display mutation, then wait for the compositor to
  // publish two clean frames before a screenshot is requested.
  if (typeof document !== 'undefined') void document.documentElement.offsetHeight;
  await waitForPaint();
  await waitForPaint();
}
