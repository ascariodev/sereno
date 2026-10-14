use tauri::{
  AppHandle, Manager, WindowEvent,
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const MAIN_WINDOW: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_QUIT: &str = "quit";
const HIDDEN_ARG: &str = "--hidden";

fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

#[tauri::command]
fn focus_main_window(app: AppHandle) {
  show_main_window(&app);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
  let open = MenuItem::with_id(app, MENU_OPEN, "Open Sereno", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open, &quit])?;

  let mut tray = TrayIconBuilder::with_id("main")
    .tooltip("Sereno")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id().as_ref() {
      MENU_OPEN => show_main_window(app),
      MENU_QUIT => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        show_main_window(tray.app_handle());
      }
    });
  if let Some(icon) = app.default_window_icon() {
    tray = tray.icon(icon.clone());
  }
  tray.build(app)?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if !argv.iter().any(|arg| arg == HIDDEN_ARG) {
        show_main_window(app);
      }
    }))
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec![HIDDEN_ARG]),
    ))
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![focus_main_window])
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event
        && window.label() == MAIN_WINDOW
      {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      build_tray(app.handle())?;
      if !std::env::args().any(|arg| arg == HIDDEN_ARG) {
        show_main_window(app.handle());
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
