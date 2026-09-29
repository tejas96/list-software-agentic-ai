import { applyDecorators, Body, createParamDecorator, Query, type ExecutionContext, type PipeTransform } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value ?? {});
  }
}

/** Validated request body. Also documents the schema in OpenAPI. */
export function ZBody<T extends z.ZodType>(schema: T): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodPipe(schema))(target, key, index);
    if (key !== undefined) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor) applyDecorators(ApiBody({ schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as object }))(target, key, descriptor);
    }
  };
}

/**
 * Validated query string. Repeated keys (`status=a&status=b`) and comma lists
 * (`status=a,b`) both become arrays for array fields.
 */
export function ZQuery<T extends z.ZodType>(schema: T): ParameterDecorator {
  return Query(
    new (class implements PipeTransform {
      transform(value: Record<string, unknown>) {
        const normalised: Record<string, unknown> = {};
        const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape ?? {};
        for (const [k, v] of Object.entries(value ?? {})) {
          const field = shape[k];
          const isArray = field ? unwrapIsArray(field) : false;
          if (isArray) normalised[k] = (Array.isArray(v) ? v : String(v).split(',')).filter((x) => x !== '');
          else normalised[k] = Array.isArray(v) ? v[0] : v;
        }
        return schema.parse(normalised);
      }
    })(),
  );
}

function unwrapIsArray(t: z.ZodType): boolean {
  let cur: unknown = t;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof z.ZodArray) return true;
    const def = (cur as { def?: { innerType?: unknown } }).def;
    cur = def?.innerType;
  }
  return false;
}

/** Validated route param as a UUID. */
export const UuidParam = createParamDecorator((name: string, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return z.uuid({ message: `${name} must be a valid id` }).parse(req.params[name]);
});
