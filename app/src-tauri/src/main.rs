// Windows 打包/调试时不要额外弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    history_timeline_lib::run()
}
