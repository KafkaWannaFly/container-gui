# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Volume details

Click a volume name in **Volumes** or a named mount in a container or Compose
project to open its detail page. **Overview** shows
Docker-reported storage usage, driver, scope, creation time, the engine-host
mountpoint, Compose project, driver options, and labels. **Containers** includes
running and stopped containers, their mount destinations, and read/write access.
Container names link to their detail pages.

Volume details update on Docker volume and container events and can also be
refreshed manually. Deletion is disabled while containers reference the volume;
deleting an unused volume requires confirmation and permanently removes its data.
Mountpoints belong to the Docker engine host and may not be accessible locally.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
