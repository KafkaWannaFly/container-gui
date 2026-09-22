# Container GUI — frontend is pnpm/Vite, backend is Tauri/cargo.
# Parallel targets recurse with `make -j2` rather than shell backgrounding, so
# they work under cmd.exe (PowerShell) as well as sh. `-Otarget` keeps each
# side's output in one block instead of interleaving it; a failure on either
# side fails the parent target.

.PHONY: i i-front i-back dev test test-front test-back up down fm fm-front fm-back lint lint-front lint-back

PAR := $(MAKE) -j2 -Otarget --no-print-directory

# Clearing MAKEFLAGS per cargo target hides Make's jobserver from cargo, which
# would otherwise warn that it is ignoring the inherited `-j`.
i-back test-back fm-back lint-back: MAKEFLAGS =

## Install frontend and backend dependencies in parallel.
i:
	@$(PAR) i-front i-back
i-front:
	pnpm install
i-back:
	cargo fetch --manifest-path src-tauri/Cargo.toml

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
	@$(PAR) test-front test-back
test-front:
	pnpm build
test-back:
	cargo test --manifest-path src-tauri/Cargo.toml --lib

## Format frontend (Biome) and backend (rustfmt) in parallel.
fm:
	@$(PAR) fm-front fm-back
fm-front:
	pnpm format
fm-back:
	cargo fmt --manifest-path src-tauri/Cargo.toml

## Lint frontend (Biome) and backend (clippy, warnings as errors) in parallel.
lint:
	@$(PAR) lint-front lint-back
lint-front:
	pnpm lint
lint-back:
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
