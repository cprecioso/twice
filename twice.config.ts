import { defineConfig } from "@cprecioso/twice/config";

export default defineConfig({
  tasks: {
    build: {
      run: "yarn run build",
      store: { glob: "dist/**" },
    },
    lint: {
      run: "yarn run lint",
      store: { exitCode: true },
    },
  },
});
