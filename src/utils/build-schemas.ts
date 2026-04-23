import { type ZodTypeAny, toJSONSchema } from "zod";

type SchemaMap = Record<string, ZodTypeAny>;

export function buildJsonSchemas<T extends SchemaMap>(schemas: T) {
  const jsonSchemas = Object.entries(schemas).map(([key, schema]) => {
    const { $schema, ...rest } = toJSONSchema(schema) as Record<string, unknown>;
    return { $id: key, ...rest };
  });

  const $ref = (key: keyof T & string) => ({ $ref: `${key}#` });

  return { schemas: jsonSchemas, $ref };
}
