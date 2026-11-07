import react from "@vitejs/plugin-react";

// .mjs 版本：Vite 需要能直接 import 配置。用 .ts 会走 esbuild 打包，在 DSH 沙箱里会 spawn EPERM。
// Tauri 期望 devUrl 指向固定端口。
export default {
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    target: "es2022",
  },
};
