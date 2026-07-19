/* eslint-disable @next/next/no-img-element */

/**
 * Product imagery comes from arbitrary merchant CDNs discovered at runtime,
 * so next/image remotePatterns can't enumerate them — a plain <img> with
 * lazy loading is the pragmatic choice here.
 */
export function ProductImage({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center bg-sand text-xs text-ink-soft ${className ?? ""}`}
      >
        No image
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`bg-sand object-cover ${className ?? ""}`}
    />
  );
}
