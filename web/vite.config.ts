import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      // MCP endpoints so clients (LM Studio, Claude Desktop) can point
      // at the dev port :5173 and reach the backend MCP transport on :3000.
      "/mcp": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
