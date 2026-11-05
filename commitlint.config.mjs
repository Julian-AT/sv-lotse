const scopes = [
  "repo",
  "deps",
  "ci",
  "orchestration",
  "data",
  "docs",
  "adr",
  "protocol",
  "brain",
  "engine",
  "guards",
  "pipeline",
  "retrieval",
  "documents",
  "approvals",
  "forms",
  "db",
  "web",
  "workspace",
  "ui",
  "guide",
  "knowledge",
  "catalog",
  "evals",
  "mac",
  "voice",
  "overlay",
  "bridge",
  "relatives",
  "security",
  "release",
];

const aiAttribution =
  /^(co-authored-by:|claude-session:|generated-by:)|generated with \[?(claude|codex|chatgpt|openai)|noreply@(anthropic|openai)\.com|🤖/im;

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "no-ai-attribution": ({ raw }) => [
          !aiAttribution.test(raw ?? ""),
          "remove AI attribution lines (Co-authored-by, Generated with …)",
        ],
      },
    },
  ],
  rules: {
    "header-max-length": [2, "always", 72],
    "scope-enum": [2, "always", scopes],
    "no-ai-attribution": [2, "always"],
  },
};
