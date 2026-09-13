import { execa } from "execa";

const fallbackName = "twice";
const fallbackEmail = "twice@todone.run";

/**
 * Environment variables that give git a committer/author identity when the
 * repository or user has none configured. Any identity that is already set
 * (through config or environment) is left untouched.
 */
export const gitIdentityEnv = async (cwd: string) => {
  const $ = execa({ cwd });

  const configured = (key: string) =>
    $`git config --get ${key}`.then(
      ({ stdout }) => stdout.trim() !== "",
      () => false,
    );

  const [hasName, hasEmail] = await Promise.all([
    configured("user.name"),
    configured("user.email"),
  ]);

  const env: Record<string, string> = {};

  if (!hasName) {
    env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME ?? fallbackName;
    env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME ?? fallbackName;
  }

  if (!hasEmail) {
    env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL ?? fallbackEmail;
    env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL ?? fallbackEmail;
  }

  return env;
};
