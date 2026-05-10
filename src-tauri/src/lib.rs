mod oauth;

fn migrations() -> Vec<tauri_plugin_sql::Migration> {
  vec![
    tauri_plugin_sql::Migration {
      version: 1,
      description: "create initial tables",
      sql: include_str!("../migrations/001_initial.sql"),
      kind: tauri_plugin_sql::MigrationKind::Up,
    },
    tauri_plugin_sql::Migration {
      version: 2,
      description: "add notify_offset_min to blocks",
      sql: include_str!("../migrations/002_block_notify.sql"),
      kind: tauri_plugin_sql::MigrationKind::Up,
    },
    tauri_plugin_sql::Migration {
      version: 3,
      description: "add gcal_events table for persisted raw cache",
      sql: include_str!("../migrations/003_gcal_events.sql"),
      kind: tauri_plugin_sql::MigrationKind::Up,
    },
    tauri_plugin_sql::Migration {
      version: 4,
      description: "add pinned + energy to projects",
      sql: include_str!("../migrations/004_project_pinned_energy.sql"),
      kind: tauri_plugin_sql::MigrationKind::Up,
    },
  ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:taskette.db", migrations())
        .build(),
    )
    .manage(oauth::OAuthState::new())
    .invoke_handler(tauri::generate_handler![
      oauth::gcal_oauth_connect,
      oauth::gcal_oauth_silent_refresh,
      oauth::gcal_oauth_disconnect,
      oauth::gcal_oauth_has_refresh_token,
    ])
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
