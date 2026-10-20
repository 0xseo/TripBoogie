import { cpSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: file("./"),
  publicDir: false,
  define: {
    "import.meta.url": JSON.stringify("https://localhost/fixture.js"),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [
    react(),
    {
      name: "preview-test-assets",
      closeBundle() {
        cpSync(
          file("../../public/pdfjs"),
          file("../../android/app/build/generated/keyboardTestAssets/pdfjs"),
          { recursive: true },
        );
      },
    },
  ],
  resolve: {
    alias: [
      { find: "next/image", replacement: file("../Image.tsx") },
      { find: "next/link", replacement: file("../Link.tsx") },
      { find: "@", replacement: file("../../") },
    ],
  },
  build: {
    outDir: file("../../android/app/build/generated/keyboardTestAssets"),
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: file("./fixture.tsx"),
      name: "KeyboardFixture",
      formats: ["iife"],
      fileName: () => "fixture.js",
      cssFileName: "fixture",
    },
  },
});
