fn migrations() -> Vec<tauri_plugin_sql::Migration> {
  vec![tauri_plugin_sql::Migration {
    version: 1,
    description: "create initial tables",
    sql: include_str!("../migrations/001_initial.sql"),
    kind: tauri_plugin_sql::MigrationKind::Up,
  }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:taskette.db", migrations())
        .build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
