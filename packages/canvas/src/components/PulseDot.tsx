/** The dot that pulses while an agent works: the toolbar's agent icon and the Agent tab share it. */
export function PulseDot({ active = true }: { active?: boolean }) {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      {active ? (
        <span className="absolute inline-flex size-full rounded-full bg-primary opacity-75 animate-ping motion-reduce:animate-none" />
      ) : null}
      <span
        className={`relative inline-flex size-2 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/40"}`}
      />
    </span>
  );
}
