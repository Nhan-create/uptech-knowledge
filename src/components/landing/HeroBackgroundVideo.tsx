"use client";

import { useEffect, useState } from "react";

const POSTER_SRC = "/media/hero/uptech-knowledge-hero-poster.webp";

type NetworkInformationLike = EventTarget & {
  saveData?: boolean;
};

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike;
};

export function HeroBackgroundVideo() {
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const connection = (navigator as NavigatorWithConnection).connection;

    const syncPlaybackPreference = () => {
      const canLoadVideo =
        !reducedMotion.matches && connection?.saveData !== true;

      setShouldLoadVideo(canLoadVideo);
      if (!canLoadVideo) setIsReady(false);
    };

    syncPlaybackPreference();
    reducedMotion.addEventListener("change", syncPlaybackPreference);
    connection?.addEventListener("change", syncPlaybackPreference);

    return () => {
      reducedMotion.removeEventListener("change", syncPlaybackPreference);
      connection?.removeEventListener("change", syncPlaybackPreference);
    };
  }, []);

  return (
    <div
      data-homepage-background-video
      data-media-theme="dark"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black"
    >
      <div className="absolute inset-0 opacity-100 brightness-[1.32] saturate-[1.15] contrast-[1.02]">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${POSTER_SRC})` }}
        />

        {shouldLoadVideo && !hasError ? (
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={POSTER_SRC}
            aria-hidden="true"
            tabIndex={-1}
            disablePictureInPicture
            onCanPlay={() => setIsReady(true)}
            onError={() => {
              setIsReady(false);
              setHasError(true);
            }}
            className={`absolute inset-0 size-full object-cover object-center transition-opacity duration-700 ease-out motion-reduce:transition-none ${
              isReady ? "opacity-100" : "opacity-0"
            }`}
          >
            <source
              src="/media/hero/uptech-knowledge-hero.webm"
              type="video/webm"
            />
            <source
              src="/media/hero/uptech-knowledge-hero.mp4"
              type="video/mp4"
            />
          </video>
        ) : null}
      </div>

      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(4, 8, 16, 0.08) 0%, rgba(4, 8, 16, 0.14) 55%, rgba(4, 8, 16, 0.26) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 72% 48% at 50% 28%, transparent 0%, rgba(4, 8, 16, 0.04) 62%, rgba(4, 8, 16, 0.14) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to right, rgba(4, 8, 16, 0.1) 0%, transparent 24%, transparent 76%, rgba(4, 8, 16, 0.1) 100%)",
        }}
      />
    </div>
  );
}
