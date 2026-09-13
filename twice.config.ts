import { defineConfig } from "@cprecioso/twice/config";

export default defineConfig({
  tasks: {
    build: {
      run: "yarn run build",
      store: {
        files: { glob: "dist/**" },
        stdout: true,
        stderr: true,
        exitCode: true,
      },
    },
    lint: {
      run: "yarn run lint",
      store: {
        stdout: true,
        stderr: true,
        exitCode: true,
      },
    },
  },
});
