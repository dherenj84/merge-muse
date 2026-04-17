import * as fs from "fs";
import * as path from "path";

describe("generated openapi spec", () => {
  it("exists and contains webhook path only", () => {
    const specPath = path.resolve(process.cwd(), "openapi", "swagger.json");
    expect(fs.existsSync(specPath)).toBe(true);

    const raw = fs.readFileSync(specPath, "utf8");
    const spec = JSON.parse(raw) as {
      openapi: string;
      paths: Record<string, unknown>;
    };

    expect(spec.openapi).toBe("3.0.0");
    expect(spec.paths).toHaveProperty("/webhook");
    expect(spec.paths).not.toHaveProperty("/health");
  });
});
