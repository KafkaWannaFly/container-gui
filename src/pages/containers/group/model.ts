import type { ComposeConfig, ComposeServiceConfig, ContainerSummary } from "../../../types/docker";

// Colour per service, used for log tags, chips and graph accents. Generated
// on the fly (golden-angle hue stepping) instead of picked from a fixed-size
// palette, so any number of services gets a distinct colour — a fixed list
// would start repeating once services outnumbered its entries. The hue band
// excludes yellow/orange/red, which log warn/error lines already use.
const GOLDEN_RATIO_CONJUGATE = 0.6180339887;
const HUE_START = 90;
const HUE_SPAN = 240;

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const assigned = new Map<string, string>();

export function svcColor(name: string): string {
  const existing = assigned.get(name);
  if (existing) return existing;
  const hue = HUE_START + ((assigned.size * GOLDEN_RATIO_CONJUGATE) % 1) * HUE_SPAN;
  const color = hslToHex(hue, 65, 60);
  assigned.set(name, color);
  return color;
}

export type ServiceInfo = {
  name: string;
  config: ComposeServiceConfig;
  profiles: string[];
  dependsOn: { on: string; cond: string }[];
  /** `deploy.replicas`, defaulting to 1. */
  replicas: number;
  scalable: boolean;
  hasHealthcheck: boolean;
};

function condOf(value: unknown): string {
  const raw =
    typeof value === "string" ? value : ((value as { condition?: string } | undefined)?.condition ?? "");
  if (raw.includes("healthy")) return "healthy";
  if (raw.includes("started")) return "started";
  if (raw.includes("completed")) return "completed";
  return raw || "started";
}

export function servicesOf(config: ComposeConfig | undefined): ServiceInfo[] {
  const services = config?.services ?? {};
  return Object.entries(services).map(([name, svc]) => {
    const dependsOn = Object.entries(svc.depends_on ?? {}).map(([on, value]) => ({
      on,
      cond: condOf(value),
    }));
    const replicas = svc.deploy?.replicas ?? 1;
    return {
      name,
      config: svc,
      profiles: svc.profiles ?? [],
      dependsOn,
      replicas,
      // `container_name` pins a single instance, so the stepper is hidden.
      scalable: !svc.container_name,
      hasHealthcheck: Boolean(svc.healthcheck?.test),
    };
  });
}

export function profilesOf(services: ServiceInfo[]): string[] {
  return [...new Set(services.flatMap((svc) => svc.profiles))].sort();
}

/** A profile is "on" when any of its services has a live container. */
export function activeProfiles(services: ServiceInfo[], containers: ContainerSummary[]): string[] {
  const running = new Set(containers.map((ctr) => ctr.composeService));
  return profilesOf(services).filter((profile) =>
    services.some((svc) => svc.profiles.includes(profile) && running.has(svc.name)),
  );
}

export function workdirOf(ctr: ContainerSummary | undefined): string | null {
  return ctr?.composeWorkingDir ?? null;
}

export function filesOf(ctr: ContainerSummary | undefined): string[] {
  return (ctr?.composeConfigFiles ?? "")
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
}

export function groupByService(containers: ContainerSummary[]): Map<string, ContainerSummary[]> {
  const map = new Map<string, ContainerSummary[]>();
  for (const ctr of containers) {
    const service = ctr.composeService ?? "";
    const list = map.get(service);
    if (list) list.push(ctr);
    else map.set(service, [ctr]);
  }
  return map;
}

export type ServiceState = "running" | "exited" | "paused" | "partial" | "created";

export function svcState(service: string, containers: ContainerSummary[]): ServiceState {
  const members = containers.filter((ctr) => ctr.composeService === service);
  if (members.length === 0) return "exited";
  if (members.every((ctr) => ctr.state === "running")) return "running";
  if (members.every((ctr) => ctr.state === "exited")) return "exited";
  if (members.every((ctr) => ctr.state === "paused")) return "paused";
  return "partial";
}

/** Services that would lose `service`: direct dependents, then transitive ones. */
export function impactOf(
  service: string,
  services: ServiceInfo[],
): { name: string; cond: string; via: string | null }[] {
  const out: { name: string; cond: string; via: string | null }[] = [];
  const seen = new Set([service]);
  const walk = (node: string) => {
    for (const svc of services) {
      for (const dep of svc.dependsOn) {
        if (dep.on === node && !seen.has(svc.name)) {
          seen.add(svc.name);
          out.push({ name: svc.name, cond: dep.cond, via: node === service ? null : node });
          walk(svc.name);
        }
      }
    }
  };
  walk(service);
  return out;
}
