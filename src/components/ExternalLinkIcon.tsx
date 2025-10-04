// ExternalLinkIcon.tsx
// SVG icon for external link (https://www.svgrepo.com/show/510970/external-link.svg)

export function ExternalLinkIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 15.75V18A2.25 2.25 0 0 1 16.5 20.25h-9A2.25 2.25 0 0 1 5.25 18v-9A2.25 2.25 0 0 1 7.5 6.75H10.5m3-3h6v6m-9 3 8.25-8.25" />
    </svg>
  );
}
