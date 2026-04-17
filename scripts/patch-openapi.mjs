/**
 * Post-processes the generated OpenAPI spec to add schema constraints that
 * tsoa cannot emit via @Header parameter annotations (pattern, maxLength).
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const specPath = resolve(process.cwd(), "openapi", "swagger.json");
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const headerPatches = {
  "x-hub-signature-256": {
    pattern: "^sha256=[a-f0-9]{64}$",
    maxLength: 71,
  },
  "x-github-delivery": {
    pattern: "^[0-9a-fA-F-]{36,128}$",
    maxLength: 128,
  },
};

const defaultServerUrl = "https://mergemuse.example.com/";

for (const pathItem of Object.values(spec.paths ?? {})) {
  for (const operation of Object.values(pathItem)) {
    for (const param of operation.parameters ?? []) {
      const patch = headerPatches[param.name];
      if (patch && param.schema?.type === "string") {
        Object.assign(param.schema, patch);
      }
    }
  }
}

// tsoa 7 alpha may serialize templated server variables incorrectly into
// "https://[object Object]/". Normalize to a concrete absolute URL for tooling.
const firstServer = Array.isArray(spec.servers) ? spec.servers[0] : undefined;
if (
  !firstServer ||
  typeof firstServer.url !== "string" ||
  firstServer.url.includes("[object Object]")
) {
  spec.servers = [
    {
      url: defaultServerUrl,
      description: "Self-hosted MergeMuse deployment (HTTPS only)",
    },
  ];
}

writeFileSync(specPath, JSON.stringify(spec, null, "\t"));
console.log("openapi: header schema constraints patched");
