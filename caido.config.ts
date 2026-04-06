import { defineConfig } from "@caido-community/dev";
import path from "path";

const id = "shadowshell";
export default defineConfig({
  id,
  name: "ShadowShell",
  description:
    "Multi-terminal plugin for Caido with AI preset support. Manage multiple shell tabs and launch Claude, Gemini, Codex and more with one click.",
  version: "0.1.0",
  author: {
    name: "hahwul",
    email: "hahwul@gmail.com",
    url: "https://www.hahwul.com",
  },
  plugins: [
    {
      kind: "backend",
      id: "backend",
      root: "packages/backend",
    },
    {
      kind: "frontend",
      id: "frontend",
      root: "packages/frontend",
      backend: {
        id: "backend",
      },
      vite: {
        build: {
          rollupOptions: {
            external: ["@caido/frontend-sdk"],
          },
        },
        resolve: {
          alias: [
            {
              find: "@",
              replacement: path.resolve(__dirname, "packages/frontend/src"),
            },
          ],
        },
      },
    },
  ],
});
