import * as fs from "fs";
import * as path from "path";
import type { Request, Response } from "express";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type Schema = {
  $ref?: string;
  type?: string;
  nullable?: boolean;
  enum?: JsonValue[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
};

type HeaderParameter = {
  in: string;
  name: string;
  required?: boolean;
  schema?: Schema;
};

type Operation = {
  parameters?: HeaderParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Schema }>;
  };
  responses?: Record<
    string,
    {
      content?: Record<string, { schema?: Schema }>;
    }
  >;
};

type OpenApiDocument = {
  paths?: {
    "/webhook"?: {
      post?: Operation;
    };
  };
  components?: {
    schemas?: Record<string, Schema>;
  };
};

type ContractError = {
  status: 400 | 406 | 415 | 503;
  error: string;
};

type RequestValidationResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: ContractError };

type RequestValidationOptions = {
  allowAdditionalRequestProperties?: boolean;
};

type ContractContext = {
  operation: Operation;
  schemas: Record<string, Schema>;
};

type ValidationOptions = {
  allowAdditionalObjectProperties: boolean;
};

const OPENAPI_SPEC_PATH = path.resolve(
  process.cwd(),
  "openapi",
  "swagger.json",
);

function normalizeErrorMessage(raw: string): string {
  const asciiOnly = raw.replace(/[^\x20-\x7E]/g, "?").trim();
  if (asciiOnly.length === 0) {
    return "Contract validation failed";
  }
  return asciiOnly.slice(0, 512);
}

function loadContractContext(): ContractContext | null {
  try {
    const raw = fs.readFileSync(OPENAPI_SPEC_PATH, "utf8");
    const doc = JSON.parse(raw) as OpenApiDocument;
    const operation = doc.paths?.["/webhook"]?.post;
    const schemas = doc.components?.schemas;

    if (!operation || !schemas) {
      return null;
    }

    return { operation, schemas };
  } catch {
    return null;
  }
}

let cachedContract: ContractContext | null = loadContractContext();

function ensureContract(): ContractContext | null {
  if (cachedContract !== null) {
    return cachedContract;
  }

  cachedContract = loadContractContext();
  return cachedContract;
}

export function assertWebhookContractAvailable(): void {
  const contract = ensureContract();
  if (contract !== null) {
    return;
  }

  throw new Error(
    `OpenAPI webhook contract is unavailable at ${OPENAPI_SPEC_PATH}. Run \"npm run openapi:gen\" before starting the service.`,
  );
}

function resolveSchema(
  schema: Schema | undefined,
  schemas: Record<string, Schema>,
): Schema | null {
  if (!schema) {
    return null;
  }

  if (!schema.$ref) {
    return schema;
  }

  const match = /^#\/components\/schemas\/(.+)$/.exec(schema.$ref);
  if (!match) {
    return null;
  }

  return schemas[match[1]] ?? null;
}

function validateValueAgainstSchema(
  value: JsonValue,
  schema: Schema,
  schemas: Record<string, Schema>,
  atPath: string,
  options: ValidationOptions,
): string | null {
  const resolved = resolveSchema(schema, schemas);
  if (!resolved) {
    return `Missing schema at ${atPath}`;
  }

  if (value === null) {
    if (resolved.nullable === true) {
      return null;
    }
    return `Null is not allowed at ${atPath}`;
  }

  if (
    Array.isArray(resolved.enum) &&
    !resolved.enum.some((candidate) => candidate === value)
  ) {
    return `Value at ${atPath} is not in enum`;
  }

  switch (resolved.type) {
    case "string": {
      if (typeof value !== "string") {
        return `Expected string at ${atPath}`;
      }

      if (
        typeof resolved.minLength === "number" &&
        value.length < resolved.minLength
      ) {
        return `String shorter than minLength at ${atPath}`;
      }

      if (
        typeof resolved.maxLength === "number" &&
        value.length > resolved.maxLength
      ) {
        return `String longer than maxLength at ${atPath}`;
      }

      if (typeof resolved.pattern === "string") {
        const pattern = new RegExp(resolved.pattern);
        if (!pattern.test(value)) {
          return `String does not match pattern at ${atPath}`;
        }
      }

      if (resolved.format === "uri") {
        try {
          // URL constructor throws for malformed absolute URLs.
          // eslint-disable-next-line no-new
          new URL(value);
        } catch {
          return `String is not a valid URI at ${atPath}`;
        }
      }

      return null;
    }

    case "number": {
      if (
        typeof value !== "number" ||
        Number.isNaN(value) ||
        !Number.isFinite(value)
      ) {
        return `Expected number at ${atPath}`;
      }

      if (typeof resolved.minimum === "number" && value < resolved.minimum) {
        return `Number is less than minimum at ${atPath}`;
      }

      if (typeof resolved.maximum === "number" && value > resolved.maximum) {
        return `Number is greater than maximum at ${atPath}`;
      }

      return null;
    }

    case "boolean": {
      if (typeof value !== "boolean") {
        return `Expected boolean at ${atPath}`;
      }
      return null;
    }

    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `Expected object at ${atPath}`;
      }

      const objectValue = value as Record<string, JsonValue>;
      const required = resolved.required ?? [];
      const properties = resolved.properties ?? {};

      for (const requiredKey of required) {
        if (!(requiredKey in objectValue)) {
          return `Missing required property ${atPath}.${requiredKey}`;
        }
      }

      for (const [key, childValue] of Object.entries(objectValue)) {
        const childSchema = properties[key];

        if (!childSchema) {
          continue;
        }

        const childError = validateValueAgainstSchema(
          childValue,
          childSchema,
          schemas,
          `${atPath}.${key}`,
          options,
        );
        if (childError) {
          return childError;
        }
      }

      if (options.allowAdditionalObjectProperties) {
        return null;
      }

      for (const key of Object.keys(objectValue)) {
        if (!(key in properties) && resolved.additionalProperties === false) {
          return `Unexpected property ${atPath}.${key}`;
        }
      }

      return null;
    }

    case "array": {
      if (!Array.isArray(value)) {
        return `Expected array at ${atPath}`;
      }

      if (!resolved.items) {
        return null;
      }

      for (let index = 0; index < value.length; index += 1) {
        const itemError = validateValueAgainstSchema(
          value[index],
          resolved.items,
          schemas,
          `${atPath}[${index}]`,
          options,
        );
        if (itemError) {
          return itemError;
        }
      }

      return null;
    }

    default:
      // If type is omitted, treat as pass-through.
      return null;
  }
}

function findHeaderParameter(
  operation: Operation,
  headerName: string,
): HeaderParameter | undefined {
  return operation.parameters?.find(
    (param) =>
      param.in === "header" &&
      param.name.toLowerCase() === headerName.toLowerCase(),
  );
}

function validateHeaderFromContract(
  request: Request,
  operation: Operation,
  schemas: Record<string, Schema>,
  headerName: string,
): string | null {
  const parameter = findHeaderParameter(operation, headerName);
  if (!parameter) {
    return null;
  }

  const rawHeader = request.headers[headerName.toLowerCase()];

  if (parameter.required && typeof rawHeader !== "string") {
    return `Missing ${headerName}`;
  }

  if (typeof rawHeader !== "string") {
    return null;
  }

  const schema = resolveSchema(parameter.schema, schemas);
  if (!schema) {
    return null;
  }

  const error = validateValueAgainstSchema(
    rawHeader,
    schema,
    schemas,
    `header:${headerName}`,
    { allowAdditionalObjectProperties: false },
  );
  return error;
}

function getJsonRequestBodySchema(
  operation: Operation,
  schemas: Record<string, Schema>,
): Schema | null {
  const rawSchema =
    operation.requestBody?.content?.["application/json"]?.schema;
  return resolveSchema(rawSchema, schemas);
}

function getResponseSchemaForStatus(
  operation: Operation,
  schemas: Record<string, Schema>,
  status: number,
): Schema | null {
  const statusEntry =
    operation.responses?.[String(status)] ?? operation.responses?.default;
  if (!statusEntry) {
    return null;
  }

  const schema = statusEntry.content?.["application/json"]?.schema;
  return resolveSchema(schema, schemas);
}

export function validateWebhookRequestAgainstContract(
  request: Request,
  options?: RequestValidationOptions,
): RequestValidationResult {
  const contract = ensureContract();
  if (!contract) {
    return {
      ok: false,
      reason: {
        status: 503,
        error: "OpenAPI contract is unavailable",
      },
    };
  }

  const { operation, schemas } = contract;

  if (!request.is("application/json")) {
    return {
      ok: false,
      reason: {
        status: 415,
        error: "Unsupported media type: expected application/json",
      },
    };
  }

  const acceptHeader = request.headers.accept;
  if (
    typeof acceptHeader === "string" &&
    request.accepts("application/json") === false
  ) {
    return {
      ok: false,
      reason: {
        status: 406,
        error: "Not acceptable: expected application/json",
      },
    };
  }

  const signatureHeaderError = validateHeaderFromContract(
    request,
    operation,
    schemas,
    "x-hub-signature-256",
  );
  if (signatureHeaderError) {
    return {
      ok: false,
      reason: {
        status: 400,
        error: signatureHeaderError,
      },
    };
  }

  const eventHeaderError = validateHeaderFromContract(
    request,
    operation,
    schemas,
    "x-github-event",
  );
  if (eventHeaderError) {
    return {
      ok: false,
      reason: {
        status: 400,
        error: eventHeaderError,
      },
    };
  }

  const deliveryHeaderError = validateHeaderFromContract(
    request,
    operation,
    schemas,
    "x-github-delivery",
  );
  if (deliveryHeaderError) {
    return {
      ok: false,
      reason: {
        status: 400,
        error: deliveryHeaderError,
      },
    };
  }

  if (!Buffer.isBuffer(request.body)) {
    return {
      ok: false,
      reason: {
        status: 400,
        error: "Invalid request body",
      },
    };
  }

  let parsedPayload: JsonValue;
  try {
    parsedPayload = JSON.parse(request.body.toString("utf8")) as JsonValue;
  } catch {
    return {
      ok: false,
      reason: {
        status: 400,
        error: "Invalid JSON payload",
      },
    };
  }

  const payloadSchema = getJsonRequestBodySchema(operation, schemas);
  if (!payloadSchema) {
    return {
      ok: false,
      reason: {
        status: 503,
        error: "OpenAPI request schema is unavailable",
      },
    };
  }

  const payloadValidationError = validateValueAgainstSchema(
    parsedPayload,
    payloadSchema,
    schemas,
    "body",
    {
      allowAdditionalObjectProperties:
        options?.allowAdditionalRequestProperties === true,
    },
  );
  if (payloadValidationError) {
    return {
      ok: false,
      reason: {
        status: 400,
        error: payloadValidationError,
      },
    };
  }

  return {
    ok: true,
    payload: parsedPayload as Record<string, unknown>,
  };
}

export function sendWebhookContractResponse(
  response: Response,
  status: number,
  body: Record<string, unknown>,
): void {
  const contract = ensureContract();

  if (!contract) {
    response.status(503).json({ error: "OpenAPI contract is unavailable" });
    return;
  }

  const schema = getResponseSchemaForStatus(
    contract.operation,
    contract.schemas,
    status,
  );

  if (!schema) {
    response.status(status).json(body);
    return;
  }

  const validationError = validateValueAgainstSchema(
    body as JsonValue,
    schema,
    contract.schemas,
    `response:${status}`,
    { allowAdditionalObjectProperties: false },
  );

  if (!validationError) {
    response.status(status).json(body);
    return;
  }

  const fallback = {
    error: normalizeErrorMessage(
      `Response contract violation: ${validationError}`,
    ),
  };

  const fallbackSchema =
    getResponseSchemaForStatus(contract.operation, contract.schemas, 500) ??
    getResponseSchemaForStatus(contract.operation, contract.schemas, 400) ??
    getResponseSchemaForStatus(contract.operation, contract.schemas, 401) ??
    getResponseSchemaForStatus(contract.operation, contract.schemas, 403) ??
    getResponseSchemaForStatus(contract.operation, contract.schemas, 406) ??
    getResponseSchemaForStatus(contract.operation, contract.schemas, 415) ??
    getResponseSchemaForStatus(contract.operation, contract.schemas, 429) ??
    null;

  if (fallbackSchema) {
    const fallbackError = validateValueAgainstSchema(
      fallback as JsonValue,
      fallbackSchema,
      contract.schemas,
      "response:fallback",
      { allowAdditionalObjectProperties: false },
    );
    if (!fallbackError) {
      response.status(500).json(fallback);
      return;
    }
  }

  response.status(500).json({ error: "Contract enforcement failure" });
}

export function normalizeContractError(error: string): string {
  return normalizeErrorMessage(error);
}
