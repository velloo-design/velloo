import type { AgentProviderInfo } from "@velloo/protocol/agent";
import type {
  InitCreateBody,
  InitCreated,
  InitGoal,
  InitState,
  InitStorage,
} from "@velloo/protocol/init";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  FolderGit2,
  FolderOpen,
  Globe,
  HardDrive,
  LayoutTemplate,
  PenLine,
  Sparkles,
  Square,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ProviderLogo } from "@/components/Agent/provider-logo";
import { LogoLockup } from "@/components/Logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { init } from "./api.ts";
import { type Choice, Choices } from "./Choices.tsx";

type Step = "place" | "start" | "connect" | "creating" | "ready";

const STEPS: { id: Step; label: string }[] = [
  { id: "place", label: "Project" },
  { id: "start", label: "Start" },
  { id: "connect", label: "Agents" },
];

const GOAL_ICONS: Record<InitGoal, ReactNode> = {
  "redesign-screen": <LayoutTemplate />,
  "redesign-component": <Box />,
  custom: <PenLine />,
  "capture-site": <Globe />,
  sample: <Sparkles />,
  blank: <Square />,
};

/** A screen the app doesn't have yet, in the route picker. */
const NEW_SCREEN = "__new";

interface Form {
  appRoot: string;
  storage: InitStorage;
  folder: string;
  name: string;
  library: string;
  useDesignMd: boolean;
  goal: InitGoal | undefined;
  routeId: string;
  screenName: string;
  component: string;
  request: string;
  captureUrl: string;
  agents: string[];
}

function formFor(state: InitState, previous?: Form): Form {
  return {
    appRoot: state.appRoot,
    storage: previous?.storage ?? state.fixed?.storage ?? "repository",
    folder: previous?.folder ?? "",
    name: previous?.name ?? "",
    library: state.app.library.id,
    useDesignMd: state.app.designMd?.recommended ?? true,
    goal: state.goals[0]?.value,
    routeId: state.app.routes[0]?.id ?? NEW_SCREEN,
    screenName: "",
    component: "",
    request: "",
    captureUrl: "",
    agents: previous?.agents ?? state.agents.filter((a) => a.detected && !a.wired).map((a) => a.id),
  };
}

function useSystemTheme(): void {
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", Boolean(mq?.matches));
    apply();
    mq?.addEventListener("change", apply);
    return () => mq?.removeEventListener("change", apply);
  }, []);
}

/**
 * `velloo init` in the browser: where the design goes, how it starts, which
 * other agents get Velloo — then the design opens in its canvas with the
 * chosen agent already setting it up. The app is read, never asked about.
 */
export function InitWizard() {
  useSystemTheme();
  const [state, setState] = useState<InitState | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [step, setStep] = useState<Step>("place");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InitCreated | null>(null);
  const [anotherDesign, setAnotherDesign] = useState(false);

  useEffect(() => {
    document.title = "Set up Velloo";
    init
      .state()
      .then((s) => {
        setState(s);
        setForm(formFor(s));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const patch = (next: Partial<Form>) => setForm((f) => (f ? { ...f, ...next } : f));

  const switchApp = async (appRoot: string) => {
    setError(null);
    try {
      const next = await init.state(appRoot);
      setState(next);
      setForm((f) => formFor(next, f ?? undefined));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const create = async () => {
    if (!form?.goal) return;
    setError(null);
    setStep("creating");
    const body: InitCreateBody = {
      appRoot: form.appRoot,
      storage: form.storage,
      ...(form.storage === "custom" ? { folder: form.folder } : {}),
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      goal: form.goal,
      ...(state?.app.found ? {} : { library: form.library }),
      ...(form.goal === "redesign-screen"
        ? form.routeId === NEW_SCREEN
          ? { screenName: form.screenName }
          : { routeId: form.routeId }
        : {}),
      ...(form.goal === "redesign-component" ? { component: form.component } : {}),
      ...(form.goal === "custom" ? { request: form.request } : {}),
      ...(form.goal === "capture-site" ? { captureUrl: form.captureUrl } : {}),
      useDesignMd: form.useDesignMd,
      agents: form.agents,
    };
    try {
      setCreated(await init.create(body));
      setStep("ready");
    } catch (err) {
      setError((err as Error).message);
      setStep("connect");
    }
  };

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex items-center gap-2.5 px-6 py-5">
        <LogoLockup fontSize={18} />
        {state && step !== "ready" && step !== "creating" && !showExisting(state, anotherDesign) ? (
          <StepTrail step={step} />
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 pb-16 sm:pt-12">
        {!state || !form ? (
          error ? (
            <Problem message={error} />
          ) : (
            <Waiting label="Reading your project…" />
          )
        ) : showExisting(state, anotherDesign) ? (
          <ExistingDesign
            state={state}
            onAnother={() => setAnotherDesign(true)}
            onError={setError}
            error={error}
          />
        ) : step === "place" ? (
          <PlaceStep
            state={state}
            form={form}
            patch={patch}
            switchApp={switchApp}
            error={error}
            onNext={() => setStep("start")}
          />
        ) : step === "start" ? (
          <StartStep
            state={state}
            form={form}
            patch={patch}
            onBack={() => setStep("place")}
            onNext={() => setStep("connect")}
          />
        ) : step === "connect" ? (
          <ConnectStep
            state={state}
            form={form}
            patch={patch}
            error={error}
            onBack={() => setStep("start")}
            onCreate={create}
          />
        ) : step === "creating" ? (
          <Waiting label="Creating your design…" detail="Reading your theme, fonts and screens." />
        ) : created ? (
          <ReadyStep created={created} />
        ) : null}
      </main>
    </div>
  );
}

const showExisting = (state: InitState, another: boolean) => Boolean(state.existing) && !another;

function StepTrail({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden className="h-px w-4 bg-border" /> : null}
          <span
            aria-current={i === at ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5",
              i === at && "font-medium text-foreground",
              i < at && "text-foreground/70",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums",
                i === at && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Heading({ title, description }: { title: string; description: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      <p className="text-sm text-muted-foreground text-pretty">{description}</p>
    </div>
  );
}

function Actions({ onBack, children }: { onBack?: (() => void) | undefined; children: ReactNode }) {
  return (
    <div className="mt-8 flex items-center gap-2">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
      ) : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="mt-6">
      <AlertDescription className="whitespace-pre-line">{message}</AlertDescription>
    </Alert>
  );
}

function Waiting({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <Spinner className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{label}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function ExistingDesign({
  state,
  onAnother,
  onError,
  error,
}: {
  state: InitState;
  onAnother(): void;
  onError(message: string): void;
  error: string | null;
}) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      window.location.href = (await init.openExisting()).url;
    } catch (err) {
      onError((err as Error).message);
      setOpening(false);
    }
  };
  return (
    <>
      <Heading
        title={`This project already has “${state.existing?.name}”`}
        description="Open it in the canvas, or set up another design beside it — a second canvas with its own boards and theme."
      />
      <Actions>
        <Button variant="outline" onClick={onAnother}>
          Create another design
        </Button>
        <Button onClick={open} disabled={opening}>
          {opening ? <Spinner /> : <FolderOpen />} Open {state.existing?.name}
        </Button>
      </Actions>
      {error ? <Problem message={error} /> : null}
    </>
  );
}

function SummaryRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  );
}

function AppSummary({ state }: { state: InitState }) {
  const { app } = state;
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <SummaryRow term="Components">
          {app.library.id === "none" ? "Velloo's primitives" : app.library.label}
          {app.uiLibrary && app.uiLibrary !== app.library.label ? (
            <span className="text-muted-foreground"> · your app uses {app.uiLibrary}</span>
          ) : null}
        </SummaryRow>
        {app.tailwind ? <SummaryRow term="Tailwind">v{app.tailwind}</SummaryRow> : null}
        <SummaryRow term="Theme">
          {app.themeSource ? (
            <code className="font-mono text-xs">{app.themeSource}</code>
          ) : (
            <span className="text-muted-foreground">A neutral preset until setup finds yours</span>
          )}
        </SummaryRow>
      </dl>
      {app.libraryNote ? (
        <p className="mt-3 text-xs text-muted-foreground">{app.libraryNote}</p>
      ) : null}
    </div>
  );
}

function PlaceStep({
  state,
  form,
  patch,
  switchApp,
  error,
  onNext,
}: {
  state: InitState;
  form: Form;
  patch(next: Partial<Form>): void;
  switchApp(appRoot: string): Promise<void>;
  error: string | null;
  onNext(): void;
}) {
  const [check, setCheck] = useState<{ folder: string; problem?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const external = (state.fixed?.storage ?? form.storage) === "external";

  // Checked as it's typed, so an occupied folder is said before the last step.
  useEffect(() => {
    setChecking(true);
    const timer = setTimeout(() => {
      init
        .check({
          appRoot: form.appRoot,
          storage: form.storage,
          ...(form.storage === "custom" ? { folder: form.folder } : {}),
          ...(form.name.trim() ? { name: form.name.trim() } : {}),
        })
        .then(setCheck)
        .catch((err: Error) => setCheck({ folder: "", problem: err.message }))
        .finally(() => setChecking(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [form.appRoot, form.storage, form.folder, form.name]);

  const storageChoices: Choice<InitStorage>[] = [
    {
      value: "repository",
      label: "In this repository",
      hint: `./${state.storage.repository}/ — plain files you commit with your code`,
      icon: <FolderGit2 />,
    },
    {
      value: "external",
      label: "Outside the repository",
      hint: `${state.storage.external}/ — on this computer only`,
      icon: <HardDrive />,
    },
    {
      value: "custom",
      label: "Somewhere else",
      hint: "A folder you choose",
      icon: <FolderOpen />,
    },
  ];

  return (
    <>
      <Heading
        title="Set up Velloo for your project"
        description={
          state.app.found
            ? "Velloo read your app. Your design will be made of the components it uses, in its theme."
            : "There's no app here to read yet — that's fine. Pick a library to design with."
        }
      />
      <FieldGroup>
        {state.apps.length > 0 ? (
          <Field>
            <FieldLabel htmlFor="init-app">App</FieldLabel>
            <NativeSelect
              id="init-app"
              value={form.appRoot}
              onChange={(e) => void switchApp(e.target.value)}
            >
              {state.apps.map((app) => (
                <NativeSelectOption key={app.dir} value={app.dir}>
                  {app.rel}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              This folder holds several apps. The design is for one of them.
            </FieldDescription>
          </Field>
        ) : null}

        {state.app.found ? (
          <AppSummary state={state} />
        ) : (
          <FieldSet>
            <FieldLegend variant="label">Component library</FieldLegend>
            <Choices
              label="Component library"
              columns={2}
              value={form.library}
              onChange={(library) => patch({ library })}
              choices={state.libraries.map((l) => ({ value: l.id, label: l.label, hint: l.hint }))}
            />
          </FieldSet>
        )}

        {state.app.designMd ? (
          <Field orientation="horizontal">
            <Checkbox
              id="init-design-md"
              checked={form.useDesignMd}
              onCheckedChange={(v) => patch({ useDesignMd: v === true })}
            />
            <FieldContent>
              <FieldLabel htmlFor="init-design-md">
                Theme from the {state.app.designMd.system} design system
              </FieldLabel>
              <FieldDescription>
                <code className="font-mono text-xs">{state.app.designMd.path}</code> names{" "}
                {state.app.designMd.mapped} of the {state.app.designMd.total} color roles
                {state.app.designMd.recommended
                  ? "; the rest keep the preset's colors."
                  : " — your stylesheet covers more of them."}{" "}
                Your agent follows its rules either way.
              </FieldDescription>
            </FieldContent>
          </Field>
        ) : null}

        {state.fixed ? null : (
          <FieldSet>
            <FieldLegend variant="label">Where the design lives</FieldLegend>
            <Choices
              label="Where the design lives"
              value={form.storage}
              onChange={(storage) => patch({ storage })}
              choices={storageChoices}
            />
          </FieldSet>
        )}

        {form.storage === "custom" && !state.fixed ? (
          <Field data-invalid={Boolean(check?.problem) || undefined}>
            <FieldLabel htmlFor="init-folder">Folder</FieldLabel>
            <Input
              id="init-folder"
              placeholder="design"
              value={form.folder}
              onChange={(e) => patch({ folder: e.target.value })}
              aria-invalid={Boolean(check?.problem) || undefined}
            />
            <FieldDescription>
              Relative to {state.launchRoot}, or an absolute path.
            </FieldDescription>
          </Field>
        ) : null}

        {external ? (
          <Field>
            <FieldLabel htmlFor="init-name">Name</FieldLabel>
            <Input
              id="init-name"
              placeholder={state.suggestedName}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
        ) : null}

        {check?.problem && !checking ? <FieldError>{check.problem}</FieldError> : null}
      </FieldGroup>
      <Actions>
        <Button onClick={onNext} disabled={checking || Boolean(check?.problem)}>
          Continue <ArrowRight />
        </Button>
      </Actions>
      {error ? <Problem message={error} /> : null}
    </>
  );
}

function goalReady(form: Form): boolean {
  switch (form.goal) {
    case "redesign-screen":
      return form.routeId !== NEW_SCREEN || form.screenName.trim().length > 0;
    case "redesign-component":
      return form.component.trim().length > 0;
    case "custom":
      return form.request.trim().length > 0;
    case "capture-site":
      return /^https?:\/\/\S+/.test(form.captureUrl.trim());
    case undefined:
      return false;
    default:
      return true;
  }
}

function StartStep({
  state,
  form,
  patch,
  onBack,
  onNext,
}: {
  state: InitState;
  form: Form;
  patch(next: Partial<Form>): void;
  onBack(): void;
  onNext(): void;
}) {
  const routes = state.app.routes;
  return (
    <>
      <Heading
        title="How do you want to start?"
        description="Pick a real task. Your agent starts on it in the canvas as soon as the design is ready."
      />
      <FieldGroup>
        <Choices
          label="How to start"
          value={form.goal}
          onChange={(goal) => patch({ goal })}
          choices={state.goals.map((g) => ({ ...g, icon: GOAL_ICONS[g.value] }))}
        />

        {form.goal === "redesign-screen" ? (
          <Field>
            <FieldLabel htmlFor="init-route">Screen</FieldLabel>
            {routes.length > 0 ? (
              <NativeSelect
                id="init-route"
                value={form.routeId}
                onChange={(e) => patch({ routeId: e.target.value })}
              >
                {routes.map((r) => (
                  <NativeSelectOption key={`${r.app ?? ""}:${r.id}`} value={r.id}>
                    {r.name} — {r.app ? `${r.app} ` : ""}
                    {r.routePath}
                  </NativeSelectOption>
                ))}
                <NativeSelectOption value={NEW_SCREEN}>
                  A screen my app doesn't have yet…
                </NativeSelectOption>
              </NativeSelect>
            ) : null}
            {form.routeId === NEW_SCREEN ? (
              <Input
                id={routes.length > 0 ? undefined : "init-route"}
                placeholder="e.g. Pricing, Settings, Checkout"
                value={form.screenName}
                onChange={(e) => patch({ screenName: e.target.value })}
              />
            ) : null}
          </Field>
        ) : null}

        {form.goal === "redesign-component" ? (
          <Field>
            <FieldLabel htmlFor="init-component">Component</FieldLabel>
            <Input
              id="init-component"
              placeholder="e.g. sidebar, pricing card, filter chip row"
              value={form.component}
              onChange={(e) => patch({ component: e.target.value })}
            />
            <FieldDescription>
              Whatever you'd call it in a code review — the agent finds it.
            </FieldDescription>
          </Field>
        ) : null}

        {form.goal === "custom" ? (
          <Field>
            <FieldLabel htmlFor="init-request">What should it design?</FieldLabel>
            <Textarea
              id="init-request"
              rows={3}
              placeholder="e.g. a pricing page with three tiers and a FAQ"
              value={form.request}
              onChange={(e) => patch({ request: e.target.value })}
            />
          </Field>
        ) : null}

        {form.goal === "capture-site" ? (
          <Field>
            <FieldLabel htmlFor="init-url">Site</FieldLabel>
            <Input
              id="init-url"
              type="url"
              placeholder="https://app.example.com/dashboard"
              value={form.captureUrl}
              onChange={(e) => patch({ captureUrl: e.target.value })}
            />
            <FieldDescription>
              Your agent opens it in a browser so you can sign in first.
            </FieldDescription>
          </Field>
        ) : null}
      </FieldGroup>
      <Actions onBack={onBack}>
        <Button onClick={onNext} disabled={!goalReady(form)}>
          Continue <ArrowRight />
        </Button>
      </Actions>
    </>
  );
}

function ConnectStep({
  state,
  form,
  patch,
  error,
  onBack,
  onCreate,
}: {
  state: InitState;
  form: Form;
  patch(next: Partial<Form>): void;
  error: string | null;
  onBack(): void;
  onCreate(): void;
}) {
  const toggle = (id: string, on: boolean) =>
    patch({
      agents: on ? [...new Set([...form.agents, id])] : form.agents.filter((a) => a !== id),
    });
  return (
    <>
      <Heading
        title="Use Velloo from your other agents too?"
        description="Your agent runs inside the canvas either way. Connecting also lets Claude Code, Cursor and the rest reach your designs from their own terminal or editor."
      />
      <FieldSet>
        <FieldLegend className="sr-only">Agents to connect</FieldLegend>
        <FieldGroup className="gap-3">
          {state.agents.map((agent) => (
            <Field key={agent.id} orientation="horizontal" data-disabled={agent.wired || undefined}>
              <Checkbox
                id={`init-agent-${agent.id}`}
                checked={agent.wired || form.agents.includes(agent.id)}
                disabled={agent.wired}
                onCheckedChange={(v) => toggle(agent.id, v === true)}
              />
              <FieldLabel htmlFor={`init-agent-${agent.id}`} className="font-normal">
                {agent.label}
              </FieldLabel>
              {agent.wired ? (
                <Badge variant="secondary" className="ml-auto">
                  Connected
                </Badge>
              ) : !agent.detected ? (
                <Badge variant="outline" className="ml-auto">
                  Not found here
                </Badge>
              ) : null}
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>
      <p className="mt-4 text-xs text-muted-foreground">
        Adds Velloo to each agent's own config, once for every project. Change it anytime with{" "}
        <code className="font-mono">velloo connect</code>.
      </p>
      <Actions onBack={onBack}>
        <Button onClick={onCreate}>
          Create design <ArrowRight />
        </Button>
      </Actions>
      {error ? <Problem message={error} /> : null}
    </>
  );
}

/** Claude Code first: it is the agent most people setting Velloo up have. */
const PREFERRED = ["claude-code", "codex"];

function ReadyStep({ created }: { created: InitCreated }) {
  const [providers, setProviders] = useState<AgentProviderInfo[] | null>(null);
  const [provider, setProvider] = useState<string | undefined>();
  const [opening, setOpening] = useState<"agent" | "canvas" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    init
      .agents()
      .then(({ providers }) => {
        const ready = providers
          .filter((p) => p.status === "ready")
          .sort((a, b) => rank(a.id) - rank(b.id));
        setProviders(ready);
        setProvider(ready[0]?.id);
      })
      .catch(() => setProviders([]));
  }, []);

  const open = async (withAgent: boolean) => {
    setOpening(withAgent ? "agent" : "canvas");
    setError(null);
    try {
      const { url } = await init.open(withAgent && provider ? { provider } : {});
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setOpening(null);
    }
  };

  const chosen = providers?.find((p) => p.id === provider);
  return (
    <>
      <Heading
        title="Your design is ready"
        description={
          created.prompt
            ? `Pick the agent to run beside “${created.name}” in the canvas. It starts on this right away, and you watch every change render.`
            : `Open “${created.name}” to look around. Your agent is in the canvas's Agent tab whenever you want it.`
        }
      />
      {created.prompt ? (
        <div className="mb-6 rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Your agent's first task</p>
          <p className="max-h-48 overflow-auto text-sm whitespace-pre-wrap">
            {created.prompt.replaceAll("**", "")}
          </p>
        </div>
      ) : null}
      {providers === null ? (
        <Waiting label="Looking for agents on this computer…" />
      ) : providers.length > 0 ? (
        <Choices
          label="Agent"
          columns={providers.length > 1 ? 2 : 1}
          value={provider}
          onChange={setProvider}
          choices={providers.map((p) => ({
            value: p.id,
            label: p.label,
            hint: p.account ?? p.version,
            icon: <ProviderLogo provider={p.id} />,
          }))}
        />
      ) : (
        <Alert>
          <AlertDescription>
            No agent CLI was found here. Install Claude Code or Codex to run one in the canvas — or
            give the task above to any agent connected to Velloo.
          </AlertDescription>
        </Alert>
      )}
      <Actions>
        <Button variant="ghost" onClick={() => void open(false)} disabled={opening !== null}>
          {opening === "canvas" ? <Spinner /> : null}
          {chosen ? "Open without an agent" : "Open the canvas"}
        </Button>
        {chosen ? (
          <Button onClick={() => void open(true)} disabled={opening !== null}>
            {opening === "agent" ? <Spinner /> : <ProviderLogo provider={chosen.id} />}
            Start with {chosen.label}
          </Button>
        ) : null}
      </Actions>
      {error ? <Problem message={error} /> : null}
    </>
  );
}

function rank(id: string): number {
  const at = PREFERRED.indexOf(id);
  return at === -1 ? PREFERRED.length : at;
}
