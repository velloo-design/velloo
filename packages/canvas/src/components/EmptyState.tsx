interface Props {
  title: string;
  hint?: string;
}

export function EmptyState({ title, hint }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center text-center p-12">
      <div className="max-w-md">
        <div className="text-base font-medium">{title}</div>
        {hint ? <div className="mt-2 text-sm text-[var(--color-fg-muted)]">{hint}</div> : null}
      </div>
    </div>
  );
}
