"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface Screenshot {
  id: number;
  path_thumbnail: string;
  path_full: string;
}

interface Movie {
  id: number;
  name: string;
  thumbnail: string;
  webm: { 480: string; max: string };
  mp4: { 480: string; max: string };
}

interface SteamScreenshotCarouselProps {
  screenshots: Screenshot[];
  movies?: Movie[];
  gameName: string;
}

type MediaItem =
  | { type: "screenshot"; data: Screenshot }
  | { type: "movie"; data: Movie };

export function SteamScreenshotCarousel({
  screenshots,
  movies = [],
  gameName,
}: SteamScreenshotCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const thumbContainerRef = useRef<HTMLDivElement>(null);

  // Build combined media list: movies first, then screenshots (like Steam)
  const items: MediaItem[] = [
    ...movies.map((m) => ({ type: "movie" as const, data: m })),
    ...screenshots.map((s) => ({ type: "screenshot" as const, data: s })),
  ];

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex((index + items.length) % items.length);
    },
    [items.length]
  );

  const prev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex]);
  const next = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxOpen, prev, next]);

  // Scroll active thumb into view
  useEffect(() => {
    const container = thumbContainerRef.current;
    if (!container) return;
    const activeThumb = container.children[currentIndex] as HTMLElement | undefined;
    if (activeThumb) {
      activeThumb.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [currentIndex]);

  if (items.length === 0) return null;

  const current = items[currentIndex];

  return (
    <>
      {/* Main carousel */}
      <div className="space-y-2">
        {/* Main display */}
        <div className="relative group aspect-video w-full overflow-hidden rounded-lg bg-black">
          {current.type === "screenshot" ? (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="block h-full w-full cursor-zoom-in"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.data.path_full}
                alt={`${gameName} screenshot ${currentIndex + 1}`}
                className="h-full w-full object-contain transition-opacity duration-200"
                loading="lazy"
              />
            </button>
          ) : (
            (() => {
              const videoSrc = current.data.mp4?.max || current.data.mp4?.[480] || current.data.webm?.max || current.data.webm?.[480];
              return videoSrc ? (
                <video
                  key={current.data.id}
                  src={videoSrc}
                  poster={current.data.thumbnail}
                  controls
                  className="h-full w-full object-contain"
                  preload="none"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.data.thumbnail}
                  alt={current.data.name}
                  className="h-full w-full object-contain"
                />
              );
            })()
          )}

          {/* Prev / Next arrows */}
          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={prev}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-black/80"
                aria-label="Previous"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={next}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-black/80"
                aria-label="Next"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* Counter badge */}
          <div className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
            {currentIndex + 1} / {items.length}
          </div>
        </div>

        {/* Thumbnail strip */}
        {items.length > 1 && (
          <div
            ref={thumbContainerRef}
            className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin"
          >
            {items.map((item, idx) => {
              const thumbSrc =
                item.type === "screenshot"
                  ? item.data.path_thumbnail
                  : item.data.thumbnail;
              const isActive = idx === currentIndex;
              return (
                <button
                  key={item.type === "screenshot" ? `s-${item.data.id}` : `m-${item.data.id}`}
                  type="button"
                  onClick={() => goTo(idx)}
                  className={`relative shrink-0 overflow-hidden rounded transition-all duration-150 ${
                    isActive
                      ? "ring-2 ring-blue-500 brightness-100"
                      : "brightness-50 hover:brightness-75"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbSrc}
                    alt={`Thumbnail ${idx + 1}`}
                    className="h-[52px] w-[92px] object-cover"
                    loading="lazy"
                  />
                  {item.type === "movie" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="h-5 w-5 text-white drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox overlay */}
      {lightboxOpen && current.type === "screenshot" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); prev(); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition-colors"
                aria-label="Previous"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); next(); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition-colors"
                aria-label="Next"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.data.path_full}
            alt={`${gameName} screenshot ${currentIndex + 1}`}
            className="max-h-[90vh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-sm text-white">
            {currentIndex + 1} / {items.length}
          </div>
        </div>
      )}
    </>
  );
}
