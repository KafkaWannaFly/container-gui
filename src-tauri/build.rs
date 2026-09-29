fn main() {
    // sqlx::migrate! embeds these files; rebuild when one is added or edited.
    println!("cargo:rerun-if-changed=migrations");
    tauri_build::build()
}
