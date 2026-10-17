import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [],
    server: {
      host: "127.0.0.1",
      port: Number(env.WEB_PORT ?? 4173),
      strictPort: true,
      proxy: {},
    },
    build: { outDir: "dist/web", emptyOutDir: true },
  };
});
