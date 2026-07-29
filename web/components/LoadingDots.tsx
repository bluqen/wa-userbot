// A WhatsApp-style "typing..." indicator instead of a generic spinner --
// three dots bouncing in sequence, on-brand for a chat app. Pure CSS
// (animation-delay stagger), no extra dependency.
export default function LoadingDots({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-slate-400">
      <span className="flex gap-1">
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
          style={{ animationDelay: '0ms', animationDuration: '900ms' }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
          style={{ animationDelay: '150ms', animationDuration: '900ms' }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
          style={{ animationDelay: '300ms', animationDuration: '900ms' }}
        />
      </span>
      {label && <span>{label}</span>}
    </div>
  );
}
