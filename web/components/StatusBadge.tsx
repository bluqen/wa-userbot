const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  connected: { dot: 'bg-emerald-500', label: 'Connected' },
  connecting: { dot: 'bg-amber-500 animate-pulse', label: 'Connecting' },
  disconnected: { dot: 'bg-slate-500', label: 'Disconnected' },
  logged_out: { dot: 'bg-red-500', label: 'Logged out' },
  none: { dot: 'bg-slate-600', label: 'Unknown' },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.none;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
