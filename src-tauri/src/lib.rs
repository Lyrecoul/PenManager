mod commands;
mod error;
mod market;
mod models;
mod plugins;
mod terminal;
mod transport;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect_device,
            commands::disconnect_device,
            commands::get_device_info,
            commands::get_performance_snapshot,
            commands::kill_process,
            commands::read_penmods_config,
            commands::write_penmods_config,
            commands::list_files,
            commands::create_directory,
            commands::remove_paths,
            commands::rename_path,
            commands::upload_files,
            commands::download_files,
            commands::run_command,
            commands::start_terminal,
            commands::terminal_input,
            commands::resize_terminal,
            commands::close_terminal,
            commands::list_plugins,
            commands::set_plugin_enabled,
            commands::remove_plugin,
            commands::inspect_plugin_archive,
            commands::install_plugin_archive,
            commands::load_market,
            commands::install_market_plugin,
            commands::check_penmods_update,
            commands::install_penmods_update,
            commands::restart_main_app,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PenManager");
}
