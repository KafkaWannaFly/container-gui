# Container GUI — frontend is pnpm/Vite, backend is Tauri/cargo.
# Parallel targets background each side and wait on both PIDs so a
# failure on either side fails the target.

.PHONY: i dev test up down fm lint

## Install frontend and backend dependencies in parallel.
i:
	@pnpm install & p1=$$!; cargo fetch --manifest-path src-tauri/Cargo.toml & p2=$$!; wait $$p1; wait $$p2

## Start the Tauri app (runs Vite + the Rust shell).
dev:
	pnpm tauri dev

## Create sample containers: one bare, one 1 volume/1 port, one 3 volumes/3 ports.
## The last two share a compose project group (`com.docker.compose.project`).
up:
	docker run -d --name cgui-sample-bare alpine sleep infinity
	docker compose up -d

## Remove the sample containers and volumes created by `up`.
down:
	-docker rm -f cgui-sample-bare
	-docker compose down -v

## Type-check/build the frontend and run backend tests in parallel.
test:
	@pnpm build & p1=$$!; cargo test --manifest-path src-tauri/Cargo.toml --lib & p2=$$!; wait $$p1; wait $$p2

## Format frontend (Biome) and backend (rustfmt) in parallel.
fm:
	@pnpm format & p1=$$!; cargo fmt --manifest-path src-tauri/Cargo.toml & p2=$$!; wait $$p1; wait $$p2

## Lint frontend (Biome) and backend (clippy, warnings as errors) in parallel.
lint:
	@pnpm lint & p1=$$!; cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings & p2=$$!; wait $$p1; wait $$p2
