import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUnmount } from "ahooks";
import { Alert, App, Button, Input, InputNumber, Modal, Progress, Segmented, Select, Spin, Steps } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "../lib/queryClient";
import { getEnvironmentReport, installEngine } from "../services/tauriApi";
import type { EnvironmentReport, InstallEngine, InstallEvent } from "../types/docker";
import {
  CheckOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  CodeSandboxOutlined,
  ReloadOutlined,
} from "./icons";
import { Mono, Pill } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

const STEPS = ["Check system", "Choose engine", "Install", "Ready"];

const ENGINE_META: Record<
  InstallEngine,
  {
    title: string;
    defaultUnit: string;
    unitLabel: string;
    phases: string[];
    readyLine: string;
    happen: string;
  }
> = {
  podman: {
    title: "Podman",
    defaultUnit: "podman-machine-default",
    unitLabel: "Machine",
    phases: ["Install Podman CLI", "Create machine (WSL)", "Start machine", "Verify Docker API"],
    readyLine: "Podman is installed and Container GUI is connected.",
    happen:
      "Install the Podman CLI, create a dedicated WSL machine, start it, then verify the Docker-compatible API.",
  },
  dockerWsl: {
    title: "Docker Engine (WSL)",
    defaultUnit: "Alpine",
    unitLabel: "Distribution",
    phases: ["Prepare WSL distro", "Install Docker Engine", "Configure API", "Start & verify"],
    readyLine: "Docker Engine is installed and Container GUI is connected.",
    happen:
      "Download the latest Alpine minirootfs, register it as Alpine-<version> (e.g. Alpine-3.22), install Docker with apk, expose it on loopback, then verify.",
  },
};

type CheckTone = "ok" | "warn" | "err" | "info";

function CheckRow({ tone, title, detail }: { tone: CheckTone; title: string; detail: string }) {
  const color =
    tone === "ok"
      ? "var(--green)"
      : tone === "warn"
        ? "var(--amber)"
        : tone === "err"
          ? "var(--coral)"
          : "var(--fog)";
  const mark = tone === "ok" ? "✓" : tone === "warn" ? "!" : tone === "err" ? "✕" : "·";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0" }}>
      <span
        style={{
          width: 22,
          height: 22,
          flex: "0 0 auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          fontSize: 12,
          color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
        }}
      >
        {mark}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", color: "var(--bone)", fontWeight: 500 }}>{title}</span>
        <span className="mono dim" style={{ display: "block", fontSize: 11.5 }}>
          {detail}
        </span>
      </span>
    </div>
  );
}

export default function EngineSetupWizard({ open, onClose }: Props) {
  // Mount on open only: every fresh open starts from the system check with
  // clean state, and closing unmounts (useUnmount cancels a running install).
  return open ? <Wizard onClose={onClose} /> : null;
}

function Wizard({ onClose }: { onClose: () => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [engine, setEngine] = useState<InstallEngine>("podman");
  const [unitName, setUnitName] = useState(ENGINE_META.podman.defaultUnit);
  const [dockerTarget, setDockerTarget] = useState("new");
  const [rootless, setRootless] = useState(true);
  const [cpus, setCpus] = useState(2);
  const [memoryMib, setMemoryMib] = useState(2048);
  const [diskGib, setDiskGib] = useState(100);

  const [installing, setInstalling] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(-1);
  const [phaseTotal, setPhaseTotal] = useState(4);
  const [lines, setLines] = useState<{ stream: string; text: string }[]>([]);
  const [download, setDownload] = useState<{ bytes: number; totalBytes: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  // The distro choice is encoded as "new" | `existing:<name>` | `install:<name>`.
  const targetKind = dockerTarget.startsWith("install:")
    ? "install"
    : dockerTarget.startsWith("existing:")
      ? "existing"
      : "new";
  const targetDistro = targetKind === "new" ? null : dockerTarget.slice(targetKind.length + 1);

  const env = useQuery({
    queryKey: queryKeys.environment(),
    queryFn: getEnvironmentReport,
    staleTime: 0,
  });

  useUnmount(() => disposeRef.current?.());
  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [lines, download]);

  const stop = () => {
    disposeRef.current?.();
    disposeRef.current = null;
    setInstalling(false);
  };

  const handleClose = () => {
    stop();
    onClose();
  };

  const selectEngine = (next: InstallEngine) => {
    setEngine(next);
    setUnitName(ENGINE_META[next].defaultUnit);
    setError(null);
  };

  const invalidateConnected = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.status() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.containersPrefix() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.images() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.volumes() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.system() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.environment() });
  };

  const onEvent = (event: InstallEvent) => {
    switch (event.kind) {
      case "phase":
        setPhaseIndex(event.index);
        setPhaseTotal(event.total);
        setDownload(null);
        break;
      case "line":
        setLines((prev) => [...prev.slice(-499), { stream: event.stream, text: event.text }]);
        break;
      case "download":
        setDownload({ bytes: event.bytes, totalBytes: event.totalBytes });
        break;
      case "end":
        disposeRef.current = null;
        setInstalling(false);
        if (event.error) {
          setError(event.error);
        } else {
          setError(null);
          if (event.unitName) setUnitName(event.unitName);
          invalidateConnected();
          setStep(3);
        }
        break;
    }
  };

  const beginInstall = () => {
    const name = (targetDistro ?? unitName).trim();
    if (!name) {
      message.warning("Give the machine/distribution a name first.");
      return;
    }
    setUnitName(name);
    setLines([]);
    setPhaseIndex(-1);
    setDownload(null);
    setError(null);
    setInstalling(true);
    disposeRef.current = installEngine(
      {
        engine,
        unitName: name,
        target: engine === "dockerWsl" && targetKind !== "new" ? { kind: targetKind, name } : null,
        rootless,
        cpus,
        memoryMib,
        diskGib,
      },
      onEvent,
      (err) => {
        setInstalling(false);
        disposeRef.current = null;
        setError(err.message);
      },
    );
  };

  const report = env.data;
  const virtOk = report?.virtualization !== false;
  const wslOk = report?.wsl.installed === true;
  const canContinue = virtOk && wslOk;
  // Distros owned by Docker Desktop / Podman would clash with our install.
  const localDistros = (report?.wsl.distros ?? []).filter(
    (d) => !/^(docker-desktop|podman-machine)/i.test(d.name),
  );
  const popularDistros = (report?.wsl.installables ?? []).filter(
    (name) => !localDistros.some((d) => d.name.toLowerCase() === name.toLowerCase()),
  );
  const distroOptions = [
    {
      label: "New distro",
      options: [
        {
          value: "new",
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span>Alpine · latest stable</span>
              <Pill tone="green">Recommended</Pill>
              <span className="dim" style={{ fontSize: 12 }}>
                tiny import, named Alpine-3.xx
              </span>
            </span>
          ),
        },
        ...popularDistros.map((name) => ({
          value: `install:${name}`,
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span>{name}</span>
              {name.endsWith(".04") ? <Pill tone="lav">LTS</Pill> : null}
            </span>
          ),
        })),
      ],
    },
    ...(localDistros.length
      ? [
          {
            label: "On this machine",
            options: localDistros.map((d) => ({
              value: `existing:${d.name}`,
              disabled: d.version < 2,
              label: (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>{d.name}</span>
                  <span className="dim" style={{ fontSize: 12 }}>
                    {d.state.toLowerCase()} · WSL{d.version}
                  </span>
                  {d.hasDocker ? <Pill tone="green">installed</Pill> : null}
                  {d.version < 2 ? <Pill tone="coral">WSL 1 · unsupported</Pill> : null}
                </span>
              ),
            })),
          },
        ]
      : []),
  ];
  const dockerWithTarget = engine === "dockerWsl" && targetDistro !== null;

  const meta = ENGINE_META[engine];

  /* ------------------------------ footer ------------------------------ */

  let footer: React.ReactNode;
  if (step === 0) {
    footer = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          Detection runs locally — nothing leaves your machine.
        </span>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Button onClick={handleClose}>Cancel</Button>
          <Button type="primary" disabled={!canContinue} onClick={() => setStep(1)}>
            Continue
          </Button>
        </span>
      </div>
    );
  } else if (step === 1) {
    footer = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span className="dim" style={{ fontSize: 12 }}>
          {engine === "podman"
            ? "Installs Podman CLI + a dedicated WSL machine. Your other distros are untouched."
            : dockerWithTarget
              ? `Installs the real Docker daemon into '${targetDistro}'. No GUI, no Docker Desktop license.`
              : "Installs a dedicated Alpine distro (auto-named, e.g. Alpine-3.22) with the real Docker daemon. No GUI, no license."}
        </span>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <Button onClick={() => setStep(0)}>Back</Button>
          <Button type="primary" onClick={() => setStep(2)}>
            {engine === "podman" ? "Install Podman" : "Install Docker Engine"}
          </Button>
        </span>
      </div>
    );
  } else if (step === 2) {
    footer = installing ? (
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button danger icon={<CloseOutlined />} onClick={stop}>
          Cancel install
        </Button>
      </div>
    ) : (
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button onClick={() => setStep(1)}>Back</Button>
        <Button type="primary" icon={<CloudDownloadOutlined />} onClick={beginInstall}>
          {error ? "Retry install" : "Begin install"}
        </Button>
      </div>
    );
  } else {
    footer = (
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button
          type="primary"
          icon={<CodeSandboxOutlined />}
          onClick={() => {
            handleClose();
            navigate("/containers");
          }}
        >
          Open Containers
        </Button>
      </div>
    );
  }

  /* ------------------------------- body ------------------------------- */

  let body: React.ReactNode;
  if (step === 0) {
    body = (
      <div>
        <p className="dim" style={{ marginTop: 0 }}>
          Checking what this machine already has. Nothing is installed yet.
        </p>
        {env.isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
            <Spin />
          </div>
        ) : (
          <CheckList report={report} />
        )}
        {report && !virtOk ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 12 }}
            message="Virtualization is disabled"
            description="WSL2 requires hardware virtualization. Enable Intel VT-x or AMD SVM in your firmware (BIOS/UEFI), restart, then re-check. On managed devices, contact your IT administrator."
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void env.refetch()}>
                Re-check
              </Button>
            }
          />
        ) : report && !wslOk ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="WSL2 is required"
            description={
              <span>
                The engine runs inside a lightweight WSL2 Linux environment. Install it from an elevated
                terminal with <Mono>wsl --install --no-launch</Mono>, restart Windows, then re-check. Your
                files and apps are not affected.
              </span>
            }
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void env.refetch()}>
                Re-check
              </Button>
            }
          />
        ) : null}
      </div>
    );
  } else if (step === 1) {
    body = (
      <div>
        <p className="dim" style={{ marginTop: 0 }}>
          Pick the engine to install. Container GUI is your frontend — these options install only the backend.
          Podman is the easiest; Docker Engine gives you the real Docker daemon.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <EngineCard
            selected={engine === "podman"}
            title="Podman"
            tags={
              <>
                <Pill tone="green">Recommended</Pill>
                <Pill tone="teal">Free · Apache-2.0</Pill>
              </>
            }
            desc="Open-source engine running in its own WSL2 machine. Rootless by default, Docker-compatible API on the standard named pipe."
            meta={["~250 MB download", "rootless", "no license limits"]}
            onSelect={() => selectEngine("podman")}
          />
          <EngineCard
            selected={engine === "dockerWsl"}
            title="Docker Engine (WSL)"
            tags={
              <>
                <Pill tone="teal">Backend-only</Pill>
                <Pill tone="green">Free · Apache-2.0</Pill>
              </>
            }
            desc="The real Docker daemon (moby) in a new or existing WSL distro, exposed on loopback. Full Docker API — no GUI, no Docker Desktop license."
            meta={["100% Docker API", "no GUI", "no license limits"]}
            onSelect={() => selectEngine("dockerWsl")}
            extra={
              <div style={{ marginTop: 10 }}>
                <div className="label">Install into</div>
                <Select
                  style={{ width: "100%" }}
                  value={dockerTarget}
                  onChange={setDockerTarget}
                  options={distroOptions}
                />
              </div>
            }
          />
        </div>
      </div>
    );
  } else if (step === 2) {
    body = installing ? (
      <InstallProgress
        phases={meta.phases}
        phaseIndex={phaseIndex}
        phaseTotal={phaseTotal}
        lines={lines}
        download={download}
        consoleRef={consoleRef}
      />
    ) : (
      <div>
        {error ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 14 }}
            message="Install failed"
            description={error}
          />
        ) : null}
        <p className="dim" style={{ marginTop: 0 }}>
          Configure the {engine === "podman" ? "machine" : "distribution"}, then install. Everything runs
          locally.
        </p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="label">
              {engine === "dockerWsl" ? "Target distribution" : `${meta.unitLabel} name`}
            </div>
            {engine === "dockerWsl" ? (
              <div
                className="mono"
                style={{
                  border: "1px solid var(--graphite)",
                  borderRadius: 6,
                  background: "var(--void)",
                  padding: "4px 11px",
                  lineHeight: "22px",
                  color: "var(--mist)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {targetDistro ?? "Alpine · latest stable"}
                {targetKind === "new" ? <Pill tone="green">auto-named Alpine-3.xx</Pill> : null}
                {targetKind === "install" ? <Pill tone="teal">registered via wsl --install</Pill> : null}
                {localDistros.some((d) => d.name === targetDistro && d.hasDocker) ? (
                  <Pill tone="green">Docker already installed</Pill>
                ) : null}
              </div>
            ) : (
              <Input className="mono" value={unitName} onChange={(e) => setUnitName(e.target.value)} />
            )}
          </div>
          <div>
            <div className="label">Mode</div>
            {engine === "podman" ? (
              <Segmented
                value={rootless ? "rootless" : "rootful"}
                onChange={(value) => setRootless(value === "rootless")}
                options={[
                  { label: "Rootless", value: "rootless" },
                  { label: "Rootful", value: "rootful" },
                ]}
              />
            ) : (
              <Pill tone="teal">root in WSL · isolated</Pill>
            )}
          </div>
        </div>
        {engine === "podman" ? (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div className="label">CPUs</div>
              <InputNumber min={1} max={16} value={cpus} onChange={(v) => setCpus(v ?? 2)} />
            </div>
            <div>
              <div className="label">Memory (MiB)</div>
              <InputNumber min={512} step={512} value={memoryMib} onChange={(v) => setMemoryMib(v ?? 2048)} />
            </div>
            <div>
              <div className="label">Disk (GiB)</div>
              <InputNumber min={10} value={diskGib} onChange={(v) => setDiskGib(v ?? 100)} />
            </div>
          </div>
        ) : null}
        <div className="card subtle">
          <div className="label">What will happen</div>
          <span className="dim" style={{ fontSize: 12 }}>
            {dockerWithTarget
              ? `${targetKind === "install" ? `Register '${targetDistro}' with wsl --install, then install` : "Install"} the Docker daemon into '${targetDistro}' using its own package manager (apt on Ubuntu/Debian, apk on Alpine), expose it on loopback, and start it with the distro. Existing files and packages stay untouched.`
              : meta.happen}
          </span>
        </div>
        <p className="dim" style={{ fontSize: 12, marginBottom: 0 }}>
          {engine === "podman"
            ? rootless
              ? "Rootless: containers run as your user — safer default."
              : "Rootful: needed for ports below 1024 and some bind mounts."
            : dockerWithTarget
              ? `The daemon runs as root inside '${targetDistro}'; the API binds loopback only, so nothing is reachable from your network.`
              : "The daemon runs as root inside the dedicated Alpine distro; the Windows host stays clean."}
        </p>
      </div>
    );
  } else {
    body = (
      <div>
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 18px" }}
        >
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: 99,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              color: "var(--green)",
              background: "color-mix(in srgb, var(--green) 15%, transparent)",
              marginBottom: 12,
            }}
          >
            <CheckOutlined />
          </span>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--bone)" }}>Engine ready</div>
          <span className="dim">{meta.readyLine}</span>
        </div>
        <div className="card subtle">
          <div className="mono dim" style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12 }}>
            <span>
              {meta.unitLabel}: {unitName}
            </span>
            <span>WSL2</span>
            <span>{engine === "podman" ? "npipe:////./pipe/docker_engine" : "tcp://127.0.0.1:2375"}</span>
          </div>
        </div>
        <p className="dim" style={{ fontSize: 12 }}>
          Manage it later in Settings. The Docker CLI works against the same endpoint — no DOCKER_HOST needed.
        </p>
      </div>
    );
  }

  return (
    <Modal
      open
      onCancel={handleClose}
      title="Set up container engine"
      width={680}
      footer={footer}
      mask={{ closable: false }}
      destroyOnHidden
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 20 }}
        items={STEPS.map((title) => ({ title }))}
      />
      {body}
    </Modal>
  );
}

function CheckList({ report }: { report: EnvironmentReport | undefined }) {
  if (!report) return null;
  const virt = report.virtualization;
  const distros = report.wsl.distros;
  return (
    <div>
      <CheckRow
        tone={virt === false ? "err" : virt === true ? "ok" : "info"}
        title="Hardware virtualization"
        detail={
          virt === true ? "enabled in firmware" : virt === false ? "disabled — required for WSL2" : "unknown"
        }
      />
      <CheckRow
        tone={report.wsl.installed ? "ok" : "err"}
        title="WSL2"
        detail={
          report.wsl.installed
            ? `installed${report.wsl.defaultVersion ? ` · default version ${report.wsl.defaultVersion}` : ""}`
            : "not installed"
        }
      />
      <CheckRow
        tone="info"
        title="Existing distributions"
        detail={
          distros.length
            ? distros.map((d) => (d.hasDocker ? `${d.name} (docker installed)` : d.name)).join(", ")
            : "none"
        }
      />
      <CheckRow
        tone={report.dockerVersion ? "ok" : "info"}
        title="Docker engine"
        detail={report.dockerVersion ?? "not detected"}
      />
      <CheckRow
        tone={report.podmanVersion ? "ok" : "info"}
        title="Podman"
        detail={
          report.podmanVersion
            ? `${report.podmanVersion}${report.podmanMachines.length ? ` · ${report.podmanMachines.length} machine(s)` : ""}`
            : "not detected"
        }
      />
      {report.winget ? null : (
        <CheckRow tone="warn" title="winget" detail="not detected — Podman install may need a manual CLI" />
      )}
    </div>
  );
}

function EngineCard({
  selected,
  title,
  tags,
  desc,
  meta,
  onSelect,
  extra,
}: {
  selected: boolean;
  title: string;
  tags: React.ReactNode;
  desc: string;
  meta: string[];
  onSelect: () => void;
  /** Options shown inside the card once it is selected. */
  extra?: React.ReactNode;
}) {
  return (
    <label
      className="engine-card"
      style={{
        border: `1px solid ${selected ? "var(--lime)" : "var(--graphite)"}`,
        background: selected ? "color-mix(in srgb, var(--lime) 6%, var(--obsidian))" : "var(--obsidian)",
      }}
    >
      <input type="radio" name="engine-choice" checked={selected} onChange={onSelect} />
      <span className="engine-card-radio" aria-hidden="true">
        {selected ? <span className="engine-card-radio-dot" /> : null}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, color: "var(--bone)" }}>{title}</span>
          {tags}
        </span>
        <span className="dim" style={{ display: "block", fontSize: 12.5, margin: "5px 0 8px" }}>
          {desc}
        </span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {meta.map((m) => (
            <Pill key={m}>{m}</Pill>
          ))}
        </span>
        {selected && extra ? <div style={{ width: "100%" }}>{extra}</div> : null}
      </span>
    </label>
  );
}

function InstallProgress({
  phases,
  phaseIndex,
  phaseTotal,
  lines,
  download,
  consoleRef,
}: {
  phases: string[];
  phaseIndex: number;
  phaseTotal: number;
  lines: { stream: string; text: string }[];
  download: { bytes: number; totalBytes: number | null } | null;
  consoleRef: React.RefObject<HTMLDivElement | null>;
}) {
  const overall =
    phaseIndex < 0 ? 0 : Math.min(100, Math.round(((phaseIndex + 0.5) / Math.max(phaseTotal, 1)) * 100));
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        {phases.map((name, index) => {
          const done = index < phaseIndex;
          const active = index === phaseIndex;
          return (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  flex: "0 0 auto",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  borderRadius: 99,
                  color: done ? "var(--green)" : active ? "var(--lime)" : "var(--ash)",
                  border: `1px solid ${done ? "var(--green)" : active ? "var(--lime)" : "var(--graphite)"}`,
                }}
              >
                {done ? <CheckOutlined /> : active ? <Spin size="small" /> : index + 1}
              </span>
              <span style={{ color: done || active ? "var(--bone)" : "var(--ash)", fontSize: 13 }}>
                {name}
              </span>
            </div>
          );
        })}
      </div>
      <Progress percent={overall} size="small" status="active" showInfo={false} />
      {download ? (
        <div className="dim mono" style={{ fontSize: 11.5, margin: "6px 0" }}>
          Downloading… {(download.bytes / 1_000_000).toFixed(1)}
          {download.totalBytes ? ` / ${(download.totalBytes / 1_000_000).toFixed(1)} MB` : " MB"}
        </div>
      ) : null}
      <div
        ref={consoleRef}
        className="mono"
        style={{
          marginTop: 10,
          height: 220,
          overflow: "auto",
          background: "var(--void)",
          border: "1px solid var(--graphite)",
          borderRadius: 8,
          padding: 10,
          fontSize: 11.5,
          lineHeight: 1.6,
        }}
      >
        {lines.length === 0 ? (
          <span className="dim">Output appears here once the install starts.</span>
        ) : (
          lines.map((line, index) => (
            <div key={index} style={{ color: line.stream === "stderr" ? "var(--amber)" : "var(--mist)" }}>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
