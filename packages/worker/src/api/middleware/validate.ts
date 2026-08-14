// ============================================
// Request Body Validation Module
// Lightweight, zero-dependency validation for Cloudflare Worker
// ============================================

/**
 * Represents a single validation error.
 */
export type ValidationError = {
  field: string;
  message: string;
};

/**
 * Result of validation: either the validated and typed body, or an array of errors.
 */
export type ValidationResult<T> = {
  ok: true;
  data: T;
} | {
  ok: false;
  errors: ValidationError[];
};

/**
 * Base schema validator interface.
 */
type FieldValidator = {
  validate: (value: unknown, fieldName: string) => ValidationError | null;
};

/**
 * Schema definition: maps field names to validators.
 */
type Schema = Record<string, FieldValidator>;

// ============================================
// Schema Builder Helpers
// ============================================

/**
 * String validator with optional constraints.
 */
export function string(options?: { min?: number; max?: number }): FieldValidator {
  return {
    validate: (value, fieldName) => {
      if (typeof value !== 'string') {
        return { field: fieldName, message: 'Must be a string' };
      }
      if (options?.min && value.length < options.min) {
        return { field: fieldName, message: `Must be at least ${options.min} characters` };
      }
      if (options?.max && value.length > options.max) {
        return { field: fieldName, message: `Must be at most ${options.max} characters` };
      }
      return null;
    },
  };
}

/**
 * Boolean validator.
 */
export function boolean(): FieldValidator {
  return {
    validate: (value, fieldName) => {
      if (typeof value !== 'boolean') {
        return { field: fieldName, message: 'Must be a boolean' };
      }
      return null;
    },
  };
}

/**
 * Array validator with optional item validator.
 */
export function array(itemValidator?: FieldValidator): FieldValidator {
  return {
    validate: (value, fieldName) => {
      if (!Array.isArray(value)) {
        return { field: fieldName, message: 'Must be an array' };
      }
      if (itemValidator) {
        for (let i = 0; i < value.length; i++) {
          const itemError = itemValidator.validate(value[i], `${fieldName}[${i}]`);
          if (itemError) return itemError;
        }
      }
      return null;
    },
  };
}

/**
 * Email validator.
 */
export function email(): FieldValidator {
  return {
    validate: (value, fieldName) => {
      if (typeof value !== 'string') {
        return { field: fieldName, message: 'Must be a string' };
      }
      // Basic email regex validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return { field: fieldName, message: 'Must be a valid email' };
      }
      return null;
    },
  };
}

/**
 * OneOf validator: value must match one of the allowed values.
 */
export function oneOf<T extends string | number | boolean>(
  allowedValues: readonly T[]
): FieldValidator {
  return {
    validate: (value, fieldName) => {
      if (!allowedValues.includes(value as T)) {
        return {
          field: fieldName,
          message: `Must be one of: ${allowedValues.join(', ')}`,
        };
      }
      return null;
    },
  };
}

/**
 * Object validator: validates nested objects.
 */
export function object(schema: Schema): FieldValidator {
  return {
    validate: (value, fieldName) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { field: fieldName, message: 'Must be an object' };
      }
      // Recursively validate nested object
      for (const [key, validator] of Object.entries(schema)) {
        const error = validator.validate((value as Record<string, unknown>)[key], `${fieldName}.${key}`);
        if (error) return error;
      }
      return null;
    },
  };
}

/**
 * Optional validator: wraps a validator to make a field optional.
 * If value is undefined or null, passes; otherwise validates.
 */
export function optional(validator: FieldValidator): FieldValidator {
  return {
    validate: (value, fieldName) => {
      if (value === undefined || value === null) {
        return null;
      }
      return validator.validate(value, fieldName);
    },
  };
}

// ============================================
// Main Validation Function
// ============================================

/**
 * Validate a request body against a schema.
 * Returns typed result with either validated data or errors.
 */
export function validate<T extends Record<string, unknown>>(
  body: unknown,
  schema: Schema,
  requiredFields?: string[]
): ValidationResult<T> {
  const errors: ValidationError[] = [];

  // Ensure body is an object
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      ok: false,
      errors: [{ field: 'body', message: 'Request body must be an object' }],
    };
  }

  const bodyObj = body as Record<string, unknown>;

  // Check required fields
  if (requiredFields) {
    for (const field of requiredFields) {
      if (!(field in bodyObj) || bodyObj[field] === undefined || bodyObj[field] === null) {
        errors.push({ field, message: 'This field is required' });
      }
    }
  }

  // Validate each field against schema
  for (const [fieldName, validator] of Object.entries(schema)) {
    const error = validator.validate(bodyObj[fieldName], fieldName);
    if (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: bodyObj as T };
}

// ============================================
// Pre-built Schemas
// ============================================

/**
 * POST /api/suppliers request schema.
 * Required: name, code, email_prefix
 * Optional: contact_email, contact_name, test_mode
 */
export const createSupplierSchema: Schema = {
  name: string(),
  code: string(),
  email_prefix: string(),
  contact_email: optional(email()),
  contact_name: optional(string()),
  test_mode: optional(boolean()),
};

export const createSupplierRequiredFields = ['name', 'code', 'email_prefix'];

/**
 * PATCH /api/suppliers/:id request schema.
 * All fields optional, but at least one must be present.
 */
export const patchSupplierSchema: Schema = {
  test_mode: optional(boolean()),
  name: optional(string()),
  code: optional(string()),
  email_prefix: optional(string()),
  contact_email: optional(email()),
  contact_name: optional(string()),
  active: optional(boolean()),
  extraction_template: optional(string()),
  // Corcentric DMS config
  cor_api_url: optional(string()),
  cor_username: optional(string()),
  cor_password: optional(string()),
  cor_vendor_code: optional(string()),
  cor_customer_code: optional(string()),
  cor_community_code: optional(string()),
  cor_transaction_type: optional(string()),
  cor_currency_code: optional(string()),
  cor_field_mapping: optional(string()),
  cor_mapping_config: optional(string()),
  cor_ingestion_enabled: optional(boolean()),
  cor_remit_code: optional(string()),
  cor_freight_code: optional(string()),
  // Community assignment — was missing from this schema. The validator
  // doesn't strictly reject unknown fields (they pass through), so the
  // 400 wasn't from validation per se — but the handler's allowedFields
  // wasn't picking up community_id from a malformed body shape. Adding
  // here for schema completeness + future audits.
  community_id: optional(string()),
  // PromoStandards config — added explicitly so the schema-derived
  // PATCH_SUPPLIER_ALLOWED_FIELDS list picks them up. Before adding
  // these, PS credential updates from the portal were silently dropped.
  ps_endpoint_url: optional(string()),
  ps_ws_version: optional(string()),
  ps_auth_id: optional(string()),
  ps_auth_password: optional(string()),
  ps_ingestion_enabled: optional(boolean()),
  ps_poll_interval_hours: optional(string()),
};

/**
 * Single source of truth for updatable supplier fields.
 *
 * Derived directly from `patchSupplierSchema` — every schema key is by
 * definition an allowed field. Previously three separate hand-maintained
 * copies of this list existed (this file's `allowedFields`, the same in
 * `handlers/suppliers.ts:patchSupplier`, plus the implicit schema keys),
 * and any field added to one but not another silently 400'd or was
 * dropped from persisted updates. Consolidating removes that class of bug
 * (RSK-15).
 *
 * Consumers: `validatePatchSupplier` here uses it for the "at least one
 * field" guard; the supplier handler imports it for the field-picker loop.
 */
export const PATCH_SUPPLIER_ALLOWED_FIELDS = Object.keys(
  patchSupplierSchema,
) as ReadonlyArray<keyof typeof patchSupplierSchema>;

/**
 * Custom validator for PATCH supplier: ensures at least one field is provided.
 */
export function validatePatchSupplier(
  body: unknown
): ValidationResult<Record<string, unknown>> {
  const result = validate(body, patchSupplierSchema);
  if (!result.ok) return result;

  const hasAtLeastOne = PATCH_SUPPLIER_ALLOWED_FIELDS.some(
    (field) => field in (body as Record<string, unknown>)
  );

  if (!hasAtLeastOne) {
    return {
      ok: false,
      errors: [
        {
          field: 'body',
          message: 'At least one field must be provided for update',
        },
      ],
    };
  }

  return result;
}

/**
 * PATCH /api/communities/:id request schema.
 * All fields optional, but at least one must be present.
 */
/**
 * PATCH /api/invoices/:id request schema.
 * All optional: status, feedback, needs_supplier_review, invoice_data
 */
export const patchInvoiceSchema: Schema = {
  status: optional(oneOf(['pending', 'processed', 'rejected', 'processing', 'submitted'] as const)),
  feedback: optional(string()),
  needs_supplier_review: optional(boolean()),
  invoice_data: optional(object({})), // Allow any object structure
};

// Custom value validator that accepts any type
const anyTypeValidator: FieldValidator = {
  validate: () => null, // Always valid
};

export const patchSettingsSchemaWithValue: Schema = {
  key: string(),
  value: anyTypeValidator,
};

export const patchSettingsRequiredFields = ['key', 'value'];

/**
 * POST /api/team/invite request schema (admin roles).
 * Required: email, display_name, role (admin|supplier)
 * Optional: supplier_ids (array of strings)
 */
export const inviteTeamMemberSchema: Schema = {
  email: email(),
  display_name: string(),
  role: oneOf(['admin', 'supplier'] as const),
  supplier_ids: optional(array(string())),
};

export const inviteTeamMemberRequiredFields = [
  'email',
  'display_name',
  'role',
];

/**
 * POST /api/team/invite request schema (supplier role — email invite, no password).
 * Required: email, display_name, role (supplier), supplier_id
 * No password needed — Supabase sends an invite email with a magic link.
 */
export const inviteSupplierUserSchema: Schema = {
  email: email(),
  display_name: string(),
  role: oneOf(['supplier'] as const),
  supplier_id: string(),
};

export const inviteSupplierUserRequiredFields = [
  'email',
  'display_name',
  'role',
  'supplier_id',
];
