import type { ContainerInspect, ImageInspect } from "../../../types/docker";

export const LABEL_COMPOSE_PROJECT = "com.docker.compose.project";
export const LABEL_COMPOSE_SERVICE = "com.docker.compose.service";
export const LABEL_COMPOSE_FILES = "com.docker.compose.project.config_files";

/** Props every detail tab receives. */
export type TabProps = {
  ctr: ContainerInspect;
  image: ImageInspect | undefined;
  onCopy: (text: string, what: string) => void;
};

export function containerName(ctr: ContainerInspect): string {
  return (ctr.Name ?? "").replace(/^\//, "") || ctr.Id.slice(0, 12);
}

export function composeOf(ctr: ContainerInspect) {
  const labels = ctr.Config?.Labels ?? {};
  const project = labels[LABEL_COMPOSE_PROJECT];
  if (!project) return null;
  return {
    project,
    service: labels[LABEL_COMPOSE_SERVICE] ?? "",
    files: labels[LABEL_COMPOSE_FILES] ?? "",
  };
}

/** CPU limit in cores, or null when unlimited. */
export function cpuLimit(ctr: ContainerInspect): number | null {
  const host = ctr.HostConfig;
  if (host?.NanoCpus) return host.NanoCpus / 1e9;
  if (host?.CpuQuota && host.CpuQuota > 0 && host.CpuPeriod) return host.CpuQuota / host.CpuPeriod;
  return null;
}

/** PID limit, or null when unlimited (Docker reports 0 or -1). */
export function pidsLimit(ctr: ContainerInspect): number | null {
  const limit = ctr.HostConfig?.PidsLimit;
  return limit && limit > 0 ? limit : null;
}

export function platformOf(ctr: ContainerInspect, image: ImageInspect | undefined): string {
  if (image?.Os && image.Architecture) {
    return [image.Os, image.Architecture, image.Variant].filter(Boolean).join("/");
  }
  return ctr.Platform ?? "—";
}

export type EnvSource = "image" | "compose" | "runtime";
export type EnvRow = { key: string; value: string; source: EnvSource; secret: boolean };

const SECRET_KEY = /(PASS(WORD|WD)?|SECRET|TOKEN|_KEY$|APIKEY|API_KEY|CREDENTIAL|PRIVATE|AUTH)/i;
/** `scheme://user:password@host` — credentials embedded in a URL. */
const URL_CREDENTIALS = /^[a-z][\w+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i;

export function isSecret(key: string, value: string): boolean {
  return SECRET_KEY.test(key) || URL_CREDENTIALS.test(value);
}

function splitEnv(entry: string): [string, string] {
  const at = entry.indexOf("=");
  return at < 0 ? [entry, ""] : [entry.slice(0, at), entry.slice(at + 1)];
}

/**
 * Container env with an inferred source: a variable whose value matches
 * the image's comes from the image; anything else was set when the
 * container was created — by compose when it carries compose labels.
 */
export function envRows(ctr: ContainerInspect, image: ImageInspect | undefined): EnvRow[] {
  const fromImage = new Map((image?.Config?.Env ?? []).map(splitEnv));
  const created: EnvSource = composeOf(ctr) ? "compose" : "runtime";
  return (ctr.Config?.Env ?? []).map((entry) => {
    const [key, value] = splitEnv(entry);
    return {
      key,
      value,
      source: fromImage.get(key) === value ? "image" : created,
      secret: isSecret(key, value),
    };
  });
}
