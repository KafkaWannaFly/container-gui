# Container GUI — frontend is pnpm/Vite, backend is Tauri/cargo.
# Parallel targets recurse with `make -j2` rather than shell backgrounding, so
# they work under cmd.exe (PowerShell) as well as sh. `-Otarget` keeps each
# side's output in one block instead of interleaving it; a failure on either
# side fails the parent target.

.PHONY: i i-front i-back dev test test-front test-back up profiles orphan down fm fm-front fm-back lint lint-front lint-back

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

check:
	cargo check --manifest-path src-tauri/Cargo.toml

## Start the Tauri app (runs Vite + the Rust shell).
dev:
	pnpm tauri dev

## Create the sample containers: one bare, plus the `container-gui` compose
## project (a compose group with profiles, scaling, healthchecks and volumes).
up:
	-docker network create cgui-edge
	docker run -d --name cgui-sample-bare alpine sleep infinity
	docker compose -f test-data/compose.yaml up -d

## Same group with the tools + ops profiles enabled.
profiles:
	-docker network create cgui-edge
	docker compose -f test-data/compose.yaml --profile tools --profile ops up -d

## Leave a container that no longer belongs to the group (orphan).
orphan:
	docker compose -f test-data/compose.yaml -f test-data/compose.orphan.yaml up -d legacy
	docker compose -f test-data/compose.yaml up -d

## Remove the sample containers, volumes and the external network created by `up`.
down:
	-docker rm -f cgui-sample-bare
	-docker compose -f test-data/compose.yaml --profile tools --profile ops down -v --remove-orphans
	-docker network rm cgui-edge

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
