import type { AgentProviderInfo } from "@velloo/protocol/agent";
import type {
  InitCapture,
  InitCreateBody,
  InitCreated,
  InitGoal,
  InitModels,
  InitPlace,
  InitState,
  InitStorage,
} from "@velloo/protocol/init";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Box,
  Check,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  Globe,
  HardDrive,
  LayoutTemplate,
  Link2,
  MessageSquare,
  PenLine,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type AuthStatus, loginAttemptSucceeded } from "@/api/auth";
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

type Step = "place" | "start" | "connect" | "cloud" | "creating" | "capture" | "ready";

const STEPS: { id: Step; label: string }[] = [
  { id: "place", label: "Project" },
  { id: "start", label: "Start" },
  { id: "connect", label: "Agents" },
  { id: "cloud", label: "Cloud" },
];

const GOAL_ICONS: Record<InitGoal, ReactNode> = {
  "redesign-screen": <LayoutTemplate />,
  "redesign-component": <Box />,
  custom: <PenLine />,
  "capture-site": <Globe />,
  sample: <Sparkles />,
  blank: <Square />,
  setup: <Wand2 />,
};

/** A screen typed in by name, in the route picker: one not detected, or not built yet. */
const NEW_SCREEN = "__new";

type AgentScope = "global" | "project";

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
  /** Agents to connect, by label; `agentScope` says which of their configs. */
  agents: string[];
  agentScope: AgentScope;
  /** The design goes outside the repository, so project configs aren't offered. */
  local: boolean;
  /** Agents may send Velloo product feedback; asked only once signed in. */
  feedback: boolean;
  feedbackContact: boolean;
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
    agents:
      previous?.agents ??
      state.agents.filter((a) => a.detected && a.global && !a.global.wired).map((a) => a.label),
    agentScope: previous?.agentScope ?? "global",
    local: previous?.local ?? false,
    feedback: previous?.feedback ?? false,
    feedbackContact: previous?.feedbackContact ?? false,
  };
}

/** The scope agents are connected in: a design outside the repository writes nothing into it. */
const scopeOf = (form: Form): AgentScope => (form.local ? "global" : form.agentScope);

/** The config ids the chosen agents are connected with, skipping ones already done. */
function agentIds(state: InitState, form: Form): string[] {
  const scope = scopeOf(form);
  return state.agents.flatMap((agent) => {
    const config = agent[scope];
    return form.agents.includes(agent.label) && config && !config.wired ? [config.id] : [];
  });
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

  const create = async (signedIn: boolean) => {
    if (!form?.goal || !state) return;
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
      agents: agentIds(state, form),
      ...(signedIn && !state.feedbackAnswered
        ? { feedback: { enabled: form.feedback, contactOk: form.feedback && form.feedbackContact } }
        : {}),
    };
    try {
      setCreated(await init.create(body));
      setStep(form.goal === "capture-site" ? "capture" : "ready");
    } catch (err) {
      setError((err as Error).message);
      setStep("cloud");
    }
  };

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex items-center gap-2.5 px-6 py-5">
        <LogoLockup fontSize={18} />
        {state &&
        (step === "place" || step === "start" || step === "connect" || step === "cloud") &&
        !showExisting(state, anotherDesign) ? (
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
            onBack={() => setStep("start")}
            onNext={() => setStep("cloud")}
          />
        ) : step === "cloud" ? (
          <CloudStep
            state={state}
            form={form}
            patch={patch}
            error={error}
            onBack={() => setStep("connect")}
            onCreate={create}
          />
        ) : step === "creating" ? (
          <Waiting label="Creating your design…" detail="Reading your theme, fonts and screens." />
        ) : created && step === "capture" ? (
          <CaptureStep
            url={form.captureUrl.trim()}
            onDone={(prompt) => {
              if (prompt !== undefined) setCreated({ ...created, prompt });
              setStep("ready");
            }}
          />
        ) : created ? (
          <ReadyStep created={created} toLanguage={form.goal === "setup"} />
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
          {app.library.id !== "none" ? (
            app.library.label
          ) : app.uiLibrary ? (
            <>
              {app.uiLibrary}
              <span className="text-muted-foreground"> · no Velloo adapter yet</span>
            </>
          ) : (
            "No UI library detected"
          )}
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
  const [check, setCheck] = useState<InitPlace | null>(null);
  const [checking, setChecking] = useState(false);
  const external = (state.fixed?.storage ?? form.storage) === "external";

  // Checked as it's typed, so an occupied folder is said before the last step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `patch` is a fresh closure each render.
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
        .then((place) => {
          setCheck(place);
          patch({ local: place.local });
        })
        .catch((err: Error) => setCheck({ folder: "", local: false, problem: err.message }))
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
                  {app.rel === "." ? "The whole repository (its root)" : app.rel}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              This folder holds several apps. Design one of them, or the repository as a whole.
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
        description={
          state.app.found
            ? "Your agent always sets Velloo up first — your theme, fonts and components, so the design is made of what your app really uses. Then it starts on what you pick here."
            : "Pick a real task. Your agent starts on it in the canvas as soon as the design is ready."
        }
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
                <NativeSelectOption value={NEW_SCREEN}>Enter a screen name…</NativeSelectOption>
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
            <FieldDescription>
              {routes.length > 0
                ? "The routes Velloo found in your app. Missing one? Enter its name instead."
                : "Velloo didn't find your app's routes — enter the screen's name, and your agent finds it."}
            </FieldDescription>
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
            <FieldLabel htmlFor="init-url">Where to start</FieldLabel>
            <Input
              id="init-url"
              type="url"
              placeholder={
                state.app.found
                  ? "http://localhost:3000/dashboard"
                  : "https://app.example.com/dashboard"
              }
              value={form.captureUrl}
              onChange={(e) => patch({ captureUrl: e.target.value })}
            />
            <FieldDescription>
              Once the design is made, it opens here in a browser window. Sign in if you need to and
              capture the pages you want — your agent starts with them.
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
  onBack,
  onNext,
}: {
  state: InitState;
  form: Form;
  patch(next: Partial<Form>): void;
  onBack(): void;
  onNext(): void;
}) {
  const scope = scopeOf(form);
  const selectable = state.agents.filter((a) => a[scope] && !a[scope]?.wired).map((a) => a.label);
  // A row this scope can't connect still counts as picked, so "Clear all" clears it too.
  const allSelected = selectable.length > 0 && selectable.every((l) => form.agents.includes(l));
  const toggle = (label: string, on: boolean) =>
    patch({
      agents: on ? [...new Set([...form.agents, label])] : form.agents.filter((a) => a !== label),
    });
  return (
    <>
      <Heading
        title="Use Velloo from your other agents too?"
        description="Your agent runs inside the canvas either way. Connecting also lets Claude Code, Cursor and the rest reach your designs from their own terminal or editor."
      />
      <FieldGroup>
        {form.local ? (
          <FieldDescription>
            This design lives outside the repository, so agents are connected in their own config,
            for every project — nothing is written into the repository.
          </FieldDescription>
        ) : (
          <Choices
            label="Where to connect them"
            columns={2}
            value={form.agentScope}
            onChange={(agentScope) => patch({ agentScope })}
            choices={[
              {
                value: "global",
                label: "For every project",
                hint: "Once, in each agent's own config",
              },
              {
                value: "project",
                label: "For this project only",
                hint: "In config files inside this repository",
              },
            ]}
          />
        )}
        <FieldSet>
          <div className="flex items-center justify-between">
            <FieldLegend variant="label" className="mb-0">
              Agents
            </FieldLegend>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              disabled={selectable.length === 0}
              onClick={() =>
                patch({
                  agents: allSelected ? [] : [...new Set([...form.agents, ...selectable])],
                })
              }
            >
              {allSelected ? "Clear all" : "Select all"}
            </Button>
          </div>
          <FieldGroup className="gap-3">
            {state.agents.map((agent) => {
              const config = agent[scope];
              const id = `init-agent-${agent.label.replace(/\W+/g, "-")}`;
              return (
                <Field
                  key={agent.label}
                  orientation="horizontal"
                  data-disabled={!config || config.wired || undefined}
                >
                  <Checkbox
                    id={id}
                    checked={config ? config.wired || form.agents.includes(agent.label) : false}
                    disabled={!config || config.wired}
                    onCheckedChange={(v) => toggle(agent.label, v === true)}
                  />
                  <FieldLabel htmlFor={id} className="font-normal">
                    {agent.label}
                  </FieldLabel>
                  <span className="ml-auto flex gap-1.5">
                    {!config ? (
                      <Badge variant="outline">
                        {scope === "global" ? "Project only" : "Global only"}
                      </Badge>
                    ) : config.wired ? (
                      <Badge variant="secondary">Connected</Badge>
                    ) : null}
                    {agent.detected ? null : <Badge variant="outline">Not found here</Badge>}
                  </span>
                </Field>
              );
            })}
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
      <p className="mt-4 text-xs text-muted-foreground">
        Change it anytime with <code className="font-mono">velloo connect</code>.
      </p>
      <Actions onBack={onBack}>
        <Button onClick={onNext}>
          Next <ArrowRight />
        </Button>
      </Actions>
    </>
  );
}

const PRICING_URL = "https://velloo.design/pricing/";

/** What a free Velloo Cloud account adds to the canvas, which needs none. */
const FREE: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Link2 />,
    title: "3 live share links",
    body: "Publish a board, and anyone with the link sees it just as your canvas shows it.",
  },
  {
    icon: <MessageSquare />,
    title: "Reviewers comment free",
    body: "Invite teammates and guests to pin comments. They never need a seat.",
  },
  {
    icon: <Bot />,
    title: "Comments come back",
    body: "Their threads land on your canvas, and your agent can answer and resolve them.",
  },
  {
    icon: <HardDrive />,
    title: "250 MB of storage",
    body: "For the boards you publish and the images in them.",
  },
];

/** How often a sign-in in progress is checked; the approval happens in another tab. */
const SIGN_IN_POLL_MS = 1500;

/**
 * The account step. Everything local works without one, so it is offered,
 * never required: sign up (or in) here through the same device flow the
 * canvas's account menu runs, or skip and create the design.
 */
function CloudStep({
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
  onCreate(signedIn: boolean): void;
}) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    init
      .auth()
      .then((s) => live.current && setStatus(s))
      .catch(
        () =>
          live.current && setStatus({ loggedIn: false, verified: null, login: { state: "idle" } }),
      );
    return () => {
      live.current = false;
    };
  }, []);

  const pending = status?.login.state === "pending";
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      init
        .auth()
        .then((s) => {
          if (!live.current) return;
          setStatus(s);
          if (s.login.state === "error") setProblem(s.login.message);
        })
        .catch(() => undefined);
    }, SIGN_IN_POLL_MS);
    return () => clearInterval(timer);
  }, [pending]);

  const signIn = async () => {
    setProblem(null);
    setStarting(true);
    try {
      const next = await init.signIn();
      setStatus(next);
      if (next.login.state === "error") setProblem(next.login.message);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => setStatus(await init.cancelSignIn().catch(() => status));

  const signedIn = status !== null && loginAttemptSucceeded(status) && status.verified !== false;
  return (
    <>
      <Heading
        title={signedIn ? "You're on Velloo Cloud" : "Share your designs with Velloo Cloud"}
        description={
          signedIn
            ? "Publish a board from the canvas whenever you want people to see it and comment."
            : "Optional, and free. The canvas works without an account; sign up when you want people to see your boards and comment on them."
        }
      />
      <SharePreview />
      <ul className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {FREE.map((item) => (
          <li key={item.title} className="flex gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground [&_svg]:size-4">
              {item.icon}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{item.title}</span>
              <span className="text-xs text-muted-foreground text-pretty">{item.body}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        Free forever. Free links expire 90 days after their last publish; Team and Business add
        private links and shared workspaces.{" "}
        <a
          className="font-medium text-foreground underline underline-offset-4"
          href={PRICING_URL}
          target="_blank"
          rel="noreferrer"
        >
          See plans
        </a>
      </p>
      <div className="mt-6 rounded-lg border bg-card p-4" data-testid="init-cloud-account">
        {status === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Checking your account…
          </p>
        ) : signedIn ? (
          <SignedIn status={status} state={state} form={form} patch={patch} />
        ) : pending && status.login.state === "pending" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              A browser tab opened on Velloo Cloud. Sign up or sign in there, check it shows this
              code, and approve.
            </p>
            <code className="self-start rounded-md border bg-muted px-3 py-1.5 font-mono text-lg tracking-[0.2em]">
              {status.login.userCode}
            </code>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={status.login.verificationUrl} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open it again
                </a>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void cancel()}>
                Cancel
              </Button>
              <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3" /> Waiting for approval…
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {status.loggedIn && status.verified === false
                  ? "Your sign-in has expired"
                  : "Get a free account"}
              </span>
              <span className="text-xs text-muted-foreground">
                Takes a minute in your browser. No card needed.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => void signIn()} disabled={starting}>
                Sign in
              </Button>
              <Button onClick={() => void signIn()} disabled={starting}>
                {starting ? <Spinner /> : null}
                Sign up free
              </Button>
            </div>
          </div>
        )}
        {problem ? <p className="mt-3 text-xs text-destructive">{problem}</p> : null}
      </div>
      <Actions onBack={onBack}>
        <Button
          variant={signedIn ? "default" : "outline"}
          onClick={() => onCreate(signedIn)}
          disabled={pending}
        >
          {signedIn ? "Create design" : "Skip and create design"} <ArrowRight />
        </Button>
      </Actions>
      {error ? <Problem message={error} /> : null}
    </>
  );
}

function SignedIn({
  status,
  state,
  form,
  patch,
}: {
  status: AuthStatus;
  state: InitState;
  form: Form;
  patch(next: Partial<Form>): void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-sm">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground [&_svg]:size-3">
          <Check />
        </span>
        Signed in as <span className="font-medium">{status.account?.email}</span>
      </p>
      {state.feedbackAnswered ? null : (
        <FieldGroup className="gap-3">
          <Field orientation="horizontal">
            <Checkbox
              id="init-feedback"
              checked={form.feedback}
              onCheckedChange={(v) => patch({ feedback: v === true })}
            />
            <FieldContent>
              <FieldLabel htmlFor="init-feedback" className="font-normal">
                Let my agent send feedback about Velloo
              </FieldLabel>
              <FieldDescription className="text-xs">
                Only about Velloo itself, never your designs or code. It shows you the message and
                asks first, and it's anonymous by default.
              </FieldDescription>
            </FieldContent>
          </Field>
          {form.feedback ? (
            <Field orientation="horizontal" className="pl-7">
              <Checkbox
                id="init-feedback-contact"
                checked={form.feedbackContact}
                onCheckedChange={(v) => patch({ feedbackContact: v === true })}
              />
              <FieldLabel htmlFor="init-feedback-contact" className="font-normal">
                Send it from my account, so you can reply by email
              </FieldLabel>
            </Field>
          ) : null}
        </FieldGroup>
      )}
    </div>
  );
}

/**
 * A picture of what sharing is: a board at its link, with a reviewer's notes
 * pinned on it. Drawn from the theme, so it follows light and dark.
 */
function SharePreview() {
  return (
    <div
      aria-hidden
      className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/15 via-muted/40 to-muted/20 px-6 pt-6 pb-0"
    >
      <div className="rounded-t-lg border border-b-0 bg-background shadow-sm">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-muted-foreground/25" />
            <span className="size-2 rounded-full bg-muted-foreground/25" />
            <span className="size-2 rounded-full bg-muted-foreground/25" />
          </span>
          <span className="mx-auto flex items-center gap-1.5 rounded-full bg-muted px-3 py-0.5 font-mono text-[10px] text-muted-foreground [&_svg]:size-3">
            <Link2 /> share.velloo.dev/s/your-board
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 p-4">
          {["bg-primary/70", "bg-foreground/70", "bg-primary/35"].map((tone, i) => (
            <div key={tone} className="flex flex-col gap-1.5 rounded-md border bg-card p-2">
              <span className={cn("h-6 rounded-sm", tone)} />
              <span className="h-1.5 w-3/4 rounded-full bg-muted-foreground/20" />
              <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/20" />
              <span className="mt-1 grid grid-cols-2 gap-1">
                <span className="h-4 rounded-sm bg-muted" />
                <span className={cn("h-4 rounded-sm", i === 1 ? "bg-primary/60" : "bg-muted")} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <PreviewNote className="top-14 right-4" initial="S" text="Love B. Ship it?" />
      <PreviewNote className="bottom-5 left-3" initial="M" text="Bigger price here" />
    </div>
  );
}

function PreviewNote({
  className,
  initial,
  text,
}: {
  className: string;
  initial: string;
  text: string;
}) {
  return (
    <span
      className={cn(
        "absolute flex items-center gap-1.5 rounded-full rounded-bl-sm border bg-popover py-1 pr-3 pl-1 text-[11px] font-medium shadow-md",
        className,
      )}
    >
      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
        {initial}
      </span>
      {text}
    </span>
  );
}

/** Claude Code first: it is the agent most people setting Velloo up have. */
const PREFERRED = ["claude-code", "codex"];

/** Reading an agent's models starts it, so it is done only when asked for. */
function ModelPicker({
  provider,
  label,
  model,
  onChange,
}: {
  provider: string;
  label: string;
  model: string | undefined;
  onChange(model: string | undefined): void;
}) {
  const [models, setModels] = useState<InitModels | "loading" | null>(null);

  // A different agent offers different models.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting on a switch is the point.
  useEffect(() => {
    setModels(null);
    onChange(undefined);
  }, [provider]);

  const load = async () => {
    setModels("loading");
    try {
      const read = await init.models(provider);
      setModels(read);
      onChange(read.model);
    } catch {
      setModels({ models: [] });
    }
  };

  return (
    <div className="mt-3 flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
      <span>Model</span>
      {models === null ? (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void load()}>
          {label}'s default <ChevronDown />
        </Button>
      ) : models === "loading" ? (
        <span className="flex items-center gap-1.5">
          <Spinner className="size-3" /> Asking {label}…
        </span>
      ) : models.models.length > 0 ? (
        <NativeSelect
          size="sm"
          aria-label="Model"
          value={model ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          {models.model ? null : <NativeSelectOption value="">Default</NativeSelectOption>}
          {models.models.map((m) => (
            <NativeSelectOption key={m.id} value={m.id}>
              {m.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <span>{label} picks its own.</span>
      )}
    </div>
  );
}

/**
 * The capture window, opened before the canvas so the pages are there when
 * the agent starts. Done in the window's toolbar moves on by itself.
 */
function CaptureStep({ url, onDone }: { url: string; onDone(prompt?: string): void }) {
  const [capture, setCapture] = useState<InitCapture | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    setFinishing(true);
    try {
      onDone((await init.finishCapture()).prompt);
    } catch (err) {
      setError((err as Error).message);
      setFinishing(false);
    }
  };

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (first: boolean) => {
      try {
        const next = await (first ? init.startCapture() : init.capture());
        if (!live) return;
        setCapture(next);
        if (next.state === "open") timer = setTimeout(() => void poll(false), 1000);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    };
    void poll(true);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: moves on once, when the window closes
  useEffect(() => {
    if (capture?.state === "done" && !finishing) void finish();
  }, [capture?.state]);

  const captured = capture?.captured ?? [];
  return (
    <>
      <Heading
        title="Capture your pages"
        description={
          <>
            A browser window opened on <span className="font-medium text-foreground">{url}</span>.
            Sign in if you need to, go to each page you want, and press{" "}
            <span className="font-medium text-foreground">Capture page</span> in its toolbar. Press{" "}
            <span className="font-medium text-foreground">Done</span> there when you have them all.
          </>
        }
      />
      {capture === null ? (
        <Waiting label="Opening a browser window…" />
      ) : capture.state === "unavailable" ? (
        <Alert>
          <AlertDescription className="whitespace-pre-wrap">
            {capture.problem}
            {"\n\n"}Your agent can capture the pages once the canvas is open instead.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-2">
          {captured.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {captured.map((page) => (
                <li
                  key={page.id}
                  className="flex flex-col rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <span className="truncate font-medium">{page.title || page.url}</span>
                  <span className="truncate text-xs text-muted-foreground">{page.url}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing captured yet.</p>
          )}
          {capture.state === "open" ? (
            <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3 shrink-0" />
              <span className="truncate">
                {capture.currentUrl ? `On ${capture.currentUrl}` : "Waiting for the browser…"}
              </span>
            </p>
          ) : null}
        </div>
      )}
      <Actions>
        {captured.length === 0 && capture?.state === "open" ? (
          <Button variant="ghost" onClick={() => void finish()} disabled={finishing}>
            Skip — my agent will capture
          </Button>
        ) : null}
        <Button
          onClick={() => void finish()}
          disabled={finishing || (captured.length === 0 && capture?.state !== "unavailable")}
        >
          {finishing ? <Spinner /> : null}
          Continue
          <ArrowRight />
        </Button>
      </Actions>
      {error ? <Problem message={error} /> : null}
    </>
  );
}

function ReadyStep({ created, toLanguage }: { created: InitCreated; toLanguage: boolean }) {
  const [providers, setProviders] = useState<AgentProviderInfo[] | null>(null);
  const [provider, setProvider] = useState<string | undefined>();
  const [model, setModel] = useState<string | undefined>();
  const [prompt, setPrompt] = useState(created.prompt ?? "");
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
      const { url } = await init.open(
        withAgent && provider ? { provider, prompt, ...(model ? { model } : {}) } : {},
      );
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
        <Field className="mb-6">
          <FieldLabel htmlFor="init-prompt">Your agent's first task</FieldLabel>
          <Textarea
            id="init-prompt"
            rows={7}
            className="max-h-72 text-sm"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {toLanguage ? (
            <FieldDescription>
              The canvas opens on your design language, with the agent beside it: its proposal shows
              up there for you to review, change or cancel.
            </FieldDescription>
          ) : created.setup ? (
            <FieldDescription>
              Setup comes first: it imports your theme and fonts and gets your own components
              rendering, so everything after it is made of what your app really uses.
            </FieldDescription>
          ) : null}
        </Field>
      ) : null}
      {providers === null ? (
        <Waiting label="Looking for agents on this computer…" />
      ) : providers.length > 0 ? (
        <>
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
          {chosen ? (
            <ModelPicker
              provider={chosen.id}
              label={chosen.label}
              model={model}
              onChange={setModel}
            />
          ) : null}
        </>
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
