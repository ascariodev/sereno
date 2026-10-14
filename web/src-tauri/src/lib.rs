use tauri::{
  AppHandle, Manager, WindowEvent,
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const MAIN_WINDOW: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_QUIT: &str = "quit";

fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
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
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      show_main_window(app);
    }))
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_notification::init())
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
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
