"use client";

import { useEffect, useRef } from "react";

const REVEAL_SELECTOR = "[data-reveal]";

export function LandingMotionController() {
  const spotlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const revealItems = Array.from(
      document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR),
    );
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const precisePointer = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    );

    if (reducedMotion.matches) {
      revealItems.forEach((item) => {
        item.dataset.revealed = "true";
      });
      return;
    }

    revealItems.forEach((item) => {
      if (item.getBoundingClientRect().top < window.innerHeight * 0.92) {
        item.dataset.revealed = "true";
      }
    });
    root.dataset.landingMotion = "ready";

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -10%",
        threshold: 0.12,
      },
    );

    revealItems.forEach((item) => {
      if (item.dataset.revealed !== "true") observer.observe(item);
    });

    const spotlight = spotlightRef.current;
    const hero = spotlight?.closest<HTMLElement>("[data-landing-hero]");
    let pointerFrame = 0;

    const updateSpotlight = (event: PointerEvent) => {
      if (!spotlight || !hero || !precisePointer.matches) return;

      window.cancelAnimationFrame(pointerFrame);
      pointerFrame = window.requestAnimationFrame(() => {
        const bounds = hero.getBoundingClientRect();
        const isInside =
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom;

        spotlight.dataset.active = isInside ? "true" : "false";
        if (!isInside) return;

        spotlight.style.setProperty(
          "--spotlight-x",
          `${event.clientX - bounds.left}px`,
        );
        spotlight.style.setProperty(
          "--spotlight-y",
          `${event.clientY - bounds.top}px`,
        );
      });
    };

    if (spotlight && hero && precisePointer.matches) {
      window.addEventListener("pointermove", updateSpotlight, {
        passive: true,
      });
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(pointerFrame);
      window.removeEventListener("pointermove", updateSpotlight);
      delete root.dataset.landingMotion;
    };
  }, []);

  return (
    <div
      ref={spotlightRef}
      aria-hidden="true"
      className="landing-pointer-spotlight"
    />
  );
}
