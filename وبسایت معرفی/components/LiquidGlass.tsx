"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Glass, type GlassProps } from "@samasante/liquid-glass";

/**
 * Client-only wrapper around <Glass> with two performance guards:
 *
 * 1. Hydration-safe — renders the children (and a class-equivalent wrapper) on
 *    the server and during the first client render, then swaps in <Glass> after
 *    mount, so the CTA/text is in the SSR HTML with no hydration mismatch.
 * 2. Lazy — <Glass> only initialises once the element is near the viewport, so
 *    off-screen lenses (e.g. the pricing card) don't pay the SVG-displacement
 *    cost during initial load / hero paint.
 */
export function LiquidGlass({
  children,
  className,
  style,
  maxDpr = 1.5,
  ...rest
}: GlassProps & { maxDpr?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!active) {
    return (
      <div ref={ref} className={className} style={style}>
        {children as ReactNode}
      </div>
    );
  }

  return (
    <Glass className={className} style={style} maxDpr={maxDpr} {...rest}>
      {children}
    </Glass>
  );
}
