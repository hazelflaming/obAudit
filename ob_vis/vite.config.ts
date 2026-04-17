import { defineConfig } from "vite";

const host = "0.0.0.0";
const allowedHosts = [".sagemaker.aws"];

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  server: {
    host,
    allowedHosts,
  },
  preview: {
    host,
    allowedHosts,
  },
}));
