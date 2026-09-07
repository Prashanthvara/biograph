import { useEffect, useState } from "react";

/**
 * Shown after submit, before the first assistant part arrives.
 * Elapsed time is the only motion. No shimmer under prefers-reduced-motion.
 */
export function LoadingState() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    // <output> carries an implicit role="status"; biome's useSemanticElements
    // rejects the equivalent <div role="status">.
    <output
      className="flex items-center gap-2 text-sm text-muted-foreground px-1"
      aria-live="polite"
    >
      <span
        className="inline-block h-2 w-2 rounded-full bg-accent motion-safe:animate-pulse"
        aria-hidden="true"
      />
      <span>Waiting {seconds}s</span>
    </output>
  );
}
