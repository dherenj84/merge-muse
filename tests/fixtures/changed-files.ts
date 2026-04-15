import type { ChangedFile } from "../../src/pipeline/pr-fetch";

export const sourceFile: ChangedFile = {
  filename: "src/controllers/user.ts",
  status: "modified",
  additions: 30,
  deletions: 10,
  isBinary: false,
  patch: `@@ -1,5 +1,5 @@\n-function getUser() {\n+async function getUser() {\n   return db.findUser();\n }`,
};

export const testFile: ChangedFile = {
  filename: "src/controllers/user.test.ts",
  status: "added",
  additions: 40,
  deletions: 0,
  isBinary: false,
  patch: `@@ -0,0 +1,40 @@\n+describe('getUser', () => {\n+  it('returns a user', async () => {\n+    // ...\n+  });\n+});`,
};

export const lockFile: ChangedFile = {
  filename: "package-lock.json",
  status: "modified",
  additions: 200,
  deletions: 100,
  isBinary: false,
  patch: undefined,
};

export const binaryFile: ChangedFile = {
  filename: "assets/logo.png",
  status: "modified",
  additions: 0,
  deletions: 0,
  isBinary: true,
  patch: undefined,
};

export const configFile: ChangedFile = {
  filename: ".github/workflows/ci.yml",
  status: "modified",
  additions: 5,
  deletions: 2,
  isBinary: false,
  patch: `@@ -1,5 +1,8 @@\n on:\n   push:\n+    branches: [main]`,
};
