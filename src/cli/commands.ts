import { commandsFromModules } from "@optique/discover";

export default commandsFromModules(
  import.meta.glob(["./commands/**/*.ts"], {
    eager: true,
    import: "default",
  }),
  {
    base: "./commands/",
    extensions: [".ts"],
  },
);
