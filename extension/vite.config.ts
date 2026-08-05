import { copyFile, cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

function copyExtensionFiles(): Plugin {
  return {
    name: "copy-extension-files",
    async writeBundle() {
      const outputDirectory = resolve(projectRoot, "dist");
      await Promise.all([
        copyFile(resolve(projectRoot, "manifest.json"), resolve(outputDirectory, "manifest.json")),
        cp(resolve(projectRoot, "icons"), resolve(outputDirectory, "icons"), { recursive: true }),
      ]);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
  build: {
    target: "chrome92",
    rollupOptions: {
      input: {
        background: resolve(projectRoot, "src/background/main.ts"),
        options: resolve(projectRoot, "options.html"),
        popup: resolve(projectRoot, "popup.html"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
