// Purely decorative, non-interactive chat-bubble mockup sitting behind
// every page's content -- blurred and dimmed via Tailwind utilities
// (rather than baked into the SVG itself) so it reads as atmosphere, not
// literal content, and never competes with anything real on top of it.
export default function ChatBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-[0.14] blur-3xl"
    >
      <svg viewBox="0 0 800 900" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
        <rect x="40" y="80" width="260" height="70" rx="28" fill="#7c3aed" />
        <rect x="60" y="190" width="340" height="90" rx="32" fill="#4c1d95" />
        <rect x="420" y="260" width="300" height="70" rx="28" fill="#94a3b8" />
        <rect x="60" y="330" width="220" height="60" rx="24" fill="#7c3aed" />
        <rect x="460" y="420" width="260" height="80" rx="30" fill="#4c1d95" />
        <rect x="80" y="470" width="360" height="90" rx="32" fill="#94a3b8" />
        <rect x="440" y="560" width="280" height="70" rx="28" fill="#7c3aed" />
        <rect x="60" y="620" width="240" height="60" rx="24" fill="#94a3b8" />
        <rect x="420" y="690" width="320" height="90" rx="32" fill="#4c1d95" />
        <rect x="60" y="760" width="280" height="70" rx="28" fill="#7c3aed" />
      </svg>
    </div>
  );
}
