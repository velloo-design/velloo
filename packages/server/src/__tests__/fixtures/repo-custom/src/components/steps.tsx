import { Children, cloneElement, isValidElement, type ReactNode } from "react";

export interface StepsProps {
  active?: number;
  children?: ReactNode;
}

export interface StepsStepProps {
  label: string;
}

/** Tells each step its state by cloning it — as Mantine's Timeline and Stepper do. */
export function Steps({ active = 0, children }: StepsProps) {
  return (
    <ol className="fx-steps">
      {Children.map(children, (child, i) =>
        isValidElement(child)
          ? cloneElement(child as React.ReactElement<{ __state?: string }>, {
              __state: i < active ? "done" : "todo",
            })
          : child,
      )}
    </ol>
  );
}

function Step({ label, __state }: StepsStepProps & { __state?: string }) {
  return <li data-step-state={__state ?? "unset"}>{label}</li>;
}
Steps.Step = Step;
