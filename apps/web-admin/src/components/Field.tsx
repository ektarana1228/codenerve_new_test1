export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-[color:var(--text-secondary)]">{label}</label>
      {hint && <p className="mb-2 text-xs text-[color:var(--text-secondary)]">{hint}</p>}
      {children}
    </div>
  )
}
