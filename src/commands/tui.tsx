import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { detectAll } from "../router/availability.js";
import type { Capabilities, ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { RUNNER_REGISTRY } from "../runners/registry.js";
import { readAllRunLog } from "../log/run-log.js";
import type { RunLogEntry } from "../log/run-log.js";
import { filterEntries, parseSince, summarize } from "../router/stats.js";
import type { StatsSummary } from "../router/stats.js";
import { listSessions, readSession } from "../session/store.js";
import type { SessionRecord } from "../session/store.js";
import { CODEP_VERSION } from "../version.js";

type WindowKey = "1d" | "3d" | "7d" | "all";

const WINDOWS: Record<WindowKey, { label: string; since?: string }> = {
  "1d": { label: "24h", since: "24h" },
  "3d": { label: "3d", since: "3d" },
  "7d": { label: "7d", since: "7d" },
  all: { label: "all time" },
};

interface Snapshot {
  caps: Record<ProviderId, Capabilities>;
  allEntries: RunLogEntry[];
  sessions: SessionRecord[];
  loadedAt: Date;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

async function loadSnapshot(): Promise<Snapshot> {
  const [caps, allEntries, sessions] = await Promise.all([
    detectAll({ probe: false }),
    readAllRunLog(),
    listSessions(50).catch(() => [] as SessionRecord[]),
  ]);
  return {
    caps,
    allEntries,
    sessions,
    loadedAt: new Date(),
  };
}

function Header({
  version,
  view,
  window,
  loadedAt,
}: {
  version: string;
  view: string;
  window: WindowKey;
  loadedAt?: Date;
}) {
  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
      <Text bold color="cyan">
        codep · <Text color="white">{view}</Text>{" "}
        <Text color="gray">v{version}</Text>
      </Text>
      <Text color="gray">
        window: <Text color="white">{WINDOWS[window].label}</Text>
        {loadedAt ? `  ·  updated ${formatTime(loadedAt.toISOString())}` : ""}
      </Text>
    </Box>
  );
}

function ProvidersPanel({ caps }: { caps: Record<ProviderId, Capabilities> }) {
  return (
    <Box flexDirection="column" width="50%" paddingRight={1}>
      <Text bold>Providers</Text>
      {ALL_PROVIDERS.map((id) => {
        const c = caps[id];
        const runner = RUNNER_REGISTRY[id];
        const ok = c.installed && c.authenticated;
        const icon = ok ? "✓" : c.installed ? "~" : "✗";
        const color = ok ? "green" : c.installed ? "yellow" : "red";
        const detail = c.installed
          ? c.authenticated
            ? c.binPath ?? ""
            : "not authenticated"
          : c.detail ?? "not installed";
        return (
          <Box key={id}>
            <Text color={color}>{icon} </Text>
            <Text>{runner.displayName.padEnd(14)}</Text>
            <Text color="gray">{detail}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function StatsPanel({
  summary,
  sessionCount,
  window,
}: {
  summary: StatsSummary;
  sessionCount: number;
  window: WindowKey;
}) {
  const failureRate =
    summary.totalRuns > 0
      ? Math.round((summary.failureCount / summary.totalRuns) * 100)
      : 0;
  return (
    <Box flexDirection="column" width="50%">
      <Text bold>Stats ({WINDOWS[window].label})</Text>
      <Text>
        Runs:       <Text color="white">{summary.totalRuns}</Text>
      </Text>
      <Text>
        Failures:   <Text color={summary.failureCount > 0 ? "red" : "white"}>{summary.failureCount}</Text>
        {summary.totalRuns > 0 ? <Text color="gray"> ({failureRate}%)</Text> : null}
      </Text>
      <Text>
        Timeouts:   <Text color={summary.timeoutCount > 0 ? "yellow" : "white"}>{summary.timeoutCount}</Text>
      </Text>
      <Text>
        Retries:    <Text color={summary.retryCount > 0 ? "yellow" : "white"}>{summary.retryCount}</Text>
      </Text>
      <Text>
        Degraded:   <Text color={summary.degradedCount > 0 ? "yellow" : "white"}>{summary.degradedCount}</Text>
      </Text>
      <Text>
        Est. cost:  <Text color="white">{formatCost(summary.estimatedCostUsd.total)}</Text>
      </Text>
      <Text>
        Sessions:   <Text color="white">{sessionCount}</Text>
      </Text>
    </Box>
  );
}

interface SelectableListProps<T> {
  title: string;
  items: T[];
  selectedIdx: number;
  emptyMessage: string;
  renderRow: (item: T, selected: boolean) => React.ReactNode;
}

function SelectableList<T>({
  title,
  items,
  selectedIdx,
  emptyMessage,
  renderRow,
}: SelectableListProps<T>) {
  if (items.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{title}</Text>
        <Text color="gray">  {emptyMessage}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{title}</Text>
      {items.map((item, i) => (
        <Box key={i}>{renderRow(item, i === selectedIdx)}</Box>
      ))}
    </Box>
  );
}

function recentRows(entries: RunLogEntry[], max = 12): RunLogEntry[] {
  return entries.slice(-max).reverse();
}

function runRow(e: RunLogEntry, selected: boolean): React.ReactNode {
  const provider =
    e.attempt && e.attempt > 1 ? `${e.provider}#${e.attempt}` : e.provider;
  const status = e.timedOut
    ? "timeout"
    : e.exitCode === 0 || e.exitCode === undefined
      ? "ok"
      : `exit ${e.exitCode}`;
  const color =
    e.timedOut || (e.exitCode !== undefined && e.exitCode !== 0)
      ? "red"
      : "green";
  const cursor = selected ? "›" : " ";
  return (
    <>
      <Text color={selected ? "cyan" : "gray"}>{cursor} </Text>
      <Text color="gray">{formatTime(e.ts)}  </Text>
      <Text color={selected ? "cyan" : undefined}>
        {provider.padEnd(14)}
      </Text>
      <Text color="gray">{e.taskType.padEnd(22)}</Text>
      <Text color={color}>{status.padEnd(10)}</Text>
      <Text color="gray">{formatDuration(e.durationMs)}</Text>
    </>
  );
}

function sessionRow(s: SessionRecord, selected: boolean): React.ReactNode {
  const cursor = selected ? "›" : " ";
  const status =
    s.exitCode === 0 ? "ok" : `exit ${s.exitCode}`;
  const color = s.exitCode === 0 ? "green" : "red";
  const promptPreview =
    s.prompt.length > 40 ? s.prompt.slice(0, 37) + "..." : s.prompt;
  return (
    <>
      <Text color={selected ? "cyan" : "gray"}>{cursor} </Text>
      <Text color="gray">{formatTime(s.ts)}  </Text>
      <Text color={selected ? "cyan" : undefined}>{s.id.padEnd(16)}</Text>
      <Text>{s.provider.padEnd(12)}</Text>
      <Text color={color}>{status.padEnd(10)}</Text>
      <Text color="gray">{promptPreview}</Text>
    </>
  );
}

function RunDetail({ entry }: { entry: RunLogEntry }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Run detail</Text>
      <Text>
        <Text color="gray">  ts:        </Text>
        {entry.ts}
      </Text>
      <Text>
        <Text color="gray">  provider:  </Text>
        {entry.provider}
        {entry.attempt && entry.attempt > 1 ? ` (attempt ${entry.attempt})` : ""}
      </Text>
      <Text>
        <Text color="gray">  taskType:  </Text>
        {entry.taskType}
      </Text>
      <Text>
        <Text color="gray">  priority:  </Text>
        {entry.priority}
      </Text>
      <Text>
        <Text color="gray">  reason:    </Text>
        {entry.reason}
      </Text>
      {entry.idealProvider ? (
        <Text>
          <Text color="gray">  ideal:     </Text>
          {entry.idealProvider}
          {entry.degraded ? <Text color="yellow"> (degraded)</Text> : null}
        </Text>
      ) : null}
      {entry.classifierSource ? (
        <Text>
          <Text color="gray">  classifier:</Text> {entry.classifierSource}
          {entry.classifierConfidence !== undefined
            ? ` (conf ${entry.classifierConfidence})`
            : ""}
        </Text>
      ) : null}
      <Text>
        <Text color="gray">  prompt:    </Text>
        sha={entry.promptHash} ({entry.promptBytes} bytes)
      </Text>
      <Text>
        <Text color="gray">  exitCode:  </Text>
        <Text color={entry.exitCode === 0 ? "green" : "red"}>
          {entry.exitCode ?? "(none)"}
        </Text>
        {entry.timedOut ? <Text color="yellow"> · timed out</Text> : null}
      </Text>
      <Text>
        <Text color="gray">  duration:  </Text>
        {formatDuration(entry.durationMs)}
      </Text>
      {entry.previousProvider ? (
        <Text>
          <Text color="gray">  retryFrom: </Text>
          {entry.previousProvider}
        </Text>
      ) : null}
    </Box>
  );
}

function SessionDetail({ session }: { session: SessionRecord }) {
  const preview =
    session.output.length > 1500
      ? session.output.slice(0, 1500) +
        `\n… (+${session.output.length - 1500} more chars)`
      : session.output;
  const promptPreview =
    session.prompt.length > 600
      ? session.prompt.slice(0, 600) +
        `\n… (+${session.prompt.length - 600} more chars)`
      : session.prompt;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Session {session.id}</Text>
      <Text>
        <Text color="gray">  ts:        </Text>
        {session.ts}
      </Text>
      <Text>
        <Text color="gray">  provider:  </Text>
        {session.provider}  <Text color="gray">·</Text>  {session.taskType}
      </Text>
      <Text>
        <Text color="gray">  exit:      </Text>
        <Text color={session.exitCode === 0 ? "green" : "red"}>
          {session.exitCode}
        </Text>{" "}
        <Text color="gray">·</Text> {formatDuration(session.durationMs)}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="gray">— prompt —</Text>
        <Text>{promptPreview || "(empty)"}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="gray">— output —</Text>
        <Text>{preview || "(no captured output)"}</Text>
      </Box>
    </Box>
  );
}

type View =
  | { kind: "dashboard" }
  | { kind: "logs"; selectedIdx: number }
  | { kind: "sessions"; selectedIdx: number }
  | { kind: "runDetail"; entry: RunLogEntry; from: View }
  | { kind: "sessionDetail"; session: SessionRecord; from: View };

function viewLabel(v: View): string {
  switch (v.kind) {
    case "dashboard":
      return "dashboard";
    case "logs":
      return "logs";
    case "sessions":
      return "sessions";
    case "runDetail":
      return "run detail";
    case "sessionDetail":
      return "session detail";
  }
}

function Footer({ view }: { view: View }) {
  let hints: string;
  switch (view.kind) {
    case "dashboard":
      hints =
        "[q] quit  [r] refresh  [l] logs  [s] sessions  [1/3/7/a] window";
      break;
    case "logs":
      hints =
        "[↑/↓] move  [enter] inspect  [esc] back  [r] refresh  [1/3/7/a] window";
      break;
    case "sessions":
      hints = "[↑/↓] move  [enter] open  [esc] back  [r] refresh";
      break;
    case "runDetail":
    case "sessionDetail":
      hints = "[esc] back  [q] quit";
      break;
  }
  return (
    <Box marginTop={1}>
      <Text color="gray">{hints}</Text>
    </Box>
  );
}

function App({ refreshMs }: { refreshMs: number }) {
  const { exit } = useApp();
  const [window, setWindow] = useState<WindowKey>("7d");
  const [snap, setSnap] = useState<Snapshot | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [detailSession, setDetailSession] = useState<SessionRecord | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    loadSnapshot()
      .then((s) => {
        if (!cancelled) setSnap(s);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);

  const filtered = useMemo(() => {
    if (!snap) return [];
    const cfg = WINDOWS[window];
    if (!cfg.since) return snap.allEntries;
    const since = parseSince(cfg.since);
    return since ? filterEntries(snap.allEntries, { since }) : snap.allEntries;
  }, [snap, window]);

  const summary = useMemo(() => summarize(filtered), [filtered]);
  const recent = useMemo(() => recentRows(filtered, 50), [filtered]);

  // Clamp selectedIdx whenever the underlying list changes.
  useEffect(() => {
    if (view.kind === "logs" && view.selectedIdx >= recent.length) {
      setView({ kind: "logs", selectedIdx: Math.max(0, recent.length - 1) });
    }
    if (
      view.kind === "sessions" &&
      snap &&
      view.selectedIdx >= snap.sessions.length
    ) {
      setView({
        kind: "sessions",
        selectedIdx: Math.max(0, snap.sessions.length - 1),
      });
    }
  }, [view, recent.length, snap]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    // Esc: pop back.
    if (key.escape) {
      if (view.kind === "runDetail" || view.kind === "sessionDetail") {
        setView(view.from);
      } else if (view.kind !== "dashboard") {
        setView({ kind: "dashboard" });
      }
      return;
    }

    // Refresh.
    if (input === "r") {
      setTick((t) => t + 1);
      return;
    }

    // Window switch — applies in dashboard and logs views.
    if (view.kind === "dashboard" || view.kind === "logs") {
      if (input === "1") {
        setWindow("1d");
        return;
      }
      if (input === "3") {
        setWindow("3d");
        return;
      }
      if (input === "7") {
        setWindow("7d");
        return;
      }
      if (input === "a") {
        setWindow("all");
        return;
      }
    }

    // Navigation between top-level views.
    if (view.kind === "dashboard") {
      if (input === "l") {
        setView({ kind: "logs", selectedIdx: 0 });
        return;
      }
      if (input === "s") {
        setView({ kind: "sessions", selectedIdx: 0 });
        return;
      }
    }

    // List movement + enter.
    if (view.kind === "logs") {
      if (key.upArrow) {
        setView({
          kind: "logs",
          selectedIdx: Math.max(0, view.selectedIdx - 1),
        });
        return;
      }
      if (key.downArrow) {
        setView({
          kind: "logs",
          selectedIdx: Math.min(recent.length - 1, view.selectedIdx + 1),
        });
        return;
      }
      if (key.return) {
        const entry = recent[view.selectedIdx];
        if (entry) setView({ kind: "runDetail", entry, from: view });
        return;
      }
      if (input === "s") {
        setView({ kind: "sessions", selectedIdx: 0 });
        return;
      }
    }

    if (view.kind === "sessions" && snap) {
      if (key.upArrow) {
        setView({
          kind: "sessions",
          selectedIdx: Math.max(0, view.selectedIdx - 1),
        });
        return;
      }
      if (key.downArrow) {
        setView({
          kind: "sessions",
          selectedIdx: Math.min(snap.sessions.length - 1, view.selectedIdx + 1),
        });
        return;
      }
      if (key.return) {
        const summary = snap.sessions[view.selectedIdx];
        if (summary) {
          // Re-read from disk to get the freshest copy (output may have grown).
          const from = view;
          readSession(summary.id)
            .then((s) => {
              const session = s ?? summary;
              setDetailSession(session);
              setView({ kind: "sessionDetail", session, from });
            })
            .catch(() => {
              setDetailSession(summary);
              setView({ kind: "sessionDetail", session: summary, from });
            });
        }
        return;
      }
      if (input === "l") {
        setView({ kind: "logs", selectedIdx: 0 });
        return;
      }
    }
  });

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">codep tui: failed to load data</Text>
        <Text color="gray">{error}</Text>
      </Box>
    );
  }

  if (!snap) {
    return (
      <Box>
        <Text color="gray">loading…</Text>
      </Box>
    );
  }

  let body: React.ReactNode;
  switch (view.kind) {
    case "dashboard":
      body = (
        <>
          <Box flexDirection="row">
            <ProvidersPanel caps={snap.caps} />
            <StatsPanel
              summary={summary}
              sessionCount={snap.sessions.length}
              window={window}
            />
          </Box>
          <SelectableList
            title="Recent runs"
            items={recentRows(filtered, 12)}
            selectedIdx={-1}
            emptyMessage='(no runs yet — try: codep "hello")'
            renderRow={(item) => runRow(item, false)}
          />
        </>
      );
      break;
    case "logs":
      body = (
        <SelectableList
          title={`Recent runs (${recent.length})`}
          items={recent}
          selectedIdx={view.selectedIdx}
          emptyMessage="(no runs match this window)"
          renderRow={runRow}
        />
      );
      break;
    case "sessions":
      body = (
        <SelectableList
          title={`Sessions (${snap.sessions.length})`}
          items={snap.sessions}
          selectedIdx={view.selectedIdx}
          emptyMessage="(no saved sessions — use --save-session on a run)"
          renderRow={sessionRow}
        />
      );
      break;
    case "runDetail":
      body = <RunDetail entry={view.entry} />;
      break;
    case "sessionDetail":
      body = <SessionDetail session={detailSession ?? view.session} />;
      break;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        version={CODEP_VERSION}
        view={viewLabel(view)}
        window={window}
        loadedAt={snap.loadedAt}
      />
      {body}
      <Footer view={view} />
    </Box>
  );
}

export interface TuiArgs {
  refreshMs?: number;
}

export async function tuiCommand(args: TuiArgs = {}): Promise<number> {
  if (!process.stdout.isTTY) {
    process.stderr.write(
      "codep tui: stdout is not a TTY. The dashboard requires an interactive terminal.\n",
    );
    return 2;
  }
  const refreshMs = args.refreshMs ?? 5_000;
  const { waitUntilExit } = render(<App refreshMs={refreshMs} />);
  await waitUntilExit();
  return 0;
}
