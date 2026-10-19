import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {cpSync} from "node:fs";
import {relative,sep} from "node:path";
import { fileURLToPath } from "node:url";
const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: file("./"),
  publicDir: false,
  plugins: [react(),{name:"copy-native-public-assets",closeBundle(){const source=file("../public");cpSync(source,file("../native-dist"),{recursive:true,filter:path=>relative(source,path).split(sep)[0]!=="downloads"});}}],
  resolve: { alias: [
    { find: "next/image", replacement: file("./Image.tsx") },
    { find: "next/link", replacement: file("./Link.tsx") },
    { find: "@", replacement: file("../") },
  ] },
  build: { outDir: file("../native-dist"), emptyOutDir: true, target: "es2022" },
});
