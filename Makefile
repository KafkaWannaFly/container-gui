# Container GUI — frontend is pnpm/Vite, backend is Tauri/cargo.
# Parallel targets background each side and wait on both PIDs so a
# failure on either side fails the target.

.PHONY: i dev test

## Install frontend and backend dependencies in parallel.
i:
	@pnpm install & p1=$$!; cargo fetch --manifest-path src-tauri/Cargo.toml & p2=$$!; wait $$p1; wait $$p2

## Start the Tauri app (runs Vite + the Rust shell).
dev:
	pnpm tauri dev

## Type-check/build the frontend and run backend tests in parallel.
test:
	@pnpm build & p1=$$!; cargo test --manifest-path src-tauri/Cargo.toml --lib & p2=$$!; wait $$p1; wait $$p2
