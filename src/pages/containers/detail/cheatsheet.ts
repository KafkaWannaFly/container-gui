export type Cheat = { cmd: string; desc: string };
export type CheatGroup = { title: string; items: Cheat[] };

const PACKAGES: Record<string, Cheat[]> = {
  alpine: [
    { cmd: "apk info", desc: "List installed packages" },
    { cmd: "apk add --no-cache curl", desc: "Install a package (lost when the container is recreated)" },
    { cmd: "apk search nginx", desc: "Search the package index" },
  ],
  debian: [
    { cmd: "dpkg -l | head -50", desc: "List installed packages" },
    {
      cmd: "apt-get update && apt-get install -y curl",
      desc: "Install a package (lost when the container is recreated)",
    },
    { cmd: "apt-cache search nginx", desc: "Search the package index" },
  ],
  rhel: [
    { cmd: "rpm -qa | head -50", desc: "List installed packages" },
    {
      cmd: "dnf install -y curl || yum install -y curl",
      desc: "Install a package (lost when the container is recreated)",
    },
  ],
};

const FAMILY: Record<string, string> = {
  alpine: "alpine",
  debian: "debian",
  ubuntu: "debian",
  rhel: "rhel",
  centos: "rhel",
  fedora: "rhel",
  rocky: "rhel",
  almalinux: "rhel",
  amzn: "rhel",
  ol: "rhel",
};

/** Common commands, with package-manager entries for the container's distro. */
export function cheatSheet(osId: string): CheatGroup[] {
  const packages = PACKAGES[FAMILY[osId] ?? ""];
  return [
    {
      title: "Navigate",
      items: [
        { cmd: "pwd", desc: "Print the current directory" },
        { cmd: "ls -la", desc: "List files, including hidden ones, with details" },
        { cmd: "cd /var/log", desc: "Change directory" },
        { cmd: "du -sh * | sort -h", desc: "Size of each entry in this directory" },
        { cmd: "df -h", desc: "Free space per mounted filesystem" },
      ],
    },
    {
      title: "Files",
      items: [
        { cmd: "cat /etc/os-release", desc: "Print a file" },
        { cmd: "tail -n 100 -f app.log", desc: "Follow a file as it grows (Ctrl+C to stop)" },
        { cmd: "grep -rn 'error' /var/log", desc: "Search text recursively with line numbers" },
        { cmd: "find / -name '*.conf' 2>/dev/null", desc: "Find files by name" },
        { cmd: "stat file", desc: "Size, permissions and timestamps of a file" },
      ],
    },
    {
      title: "Processes",
      items: [
        { cmd: "ps aux", desc: "All processes with CPU and memory use" },
        { cmd: "top", desc: "Live process view (q to quit)" },
        { cmd: "kill -HUP 1", desc: "Signal the main process, e.g. to reload config" },
        { cmd: "env | sort", desc: "Environment variables of this shell" },
      ],
    },
    {
      title: "Network",
      items: [
        { cmd: "cat /etc/hosts /etc/resolv.conf", desc: "Name resolution setup" },
        { cmd: "netstat -tlnp || ss -tlnp", desc: "Listening ports and their processes" },
        { cmd: "wget -qO- http://localhost:80/", desc: "Fetch a URL (BusyBox has wget, not curl)" },
        { cmd: "nslookup db", desc: "Resolve a service name on the Docker network" },
      ],
    },
    ...(packages ? [{ title: "Packages", items: packages }] : []),
    {
      title: "Shortcuts",
      items: [
        { cmd: "Ctrl+C", desc: "Interrupt the running command" },
        { cmd: "Ctrl+D", desc: "End the session (exit the shell)" },
        { cmd: "Ctrl+L", desc: "Clear the screen" },
        { cmd: "Ctrl+R", desc: "Search command history (bash)" },
        { cmd: "Tab", desc: "Complete a command or path" },
        { cmd: "Ctrl+Shift+C / V", desc: "Copy selection / paste" },
      ],
    },
  ];
}
