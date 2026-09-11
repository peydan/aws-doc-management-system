---
name: metadata-templates
description: Schema-driven workflow for modifying or creating document metadata templates, JSON Schemas, validator registrations, frontend UI presets, and OpenSearch mappings. Use when adding a new document class, adding/removing/renaming metadata fields, changing enum values, or updating default template values.
---

# Document Metadata Templates — Schema-Driven Architecture & Workflow

The platform operates on a **Schema-Driven Architecture**. The JSON Schemas in `schemas/*.json` are the Single Source of Truth for:
1. **Validation & Type Checking** (`Ajv`)
2. **Field Defaults & Construction** (`Ajv useDefaults` via `defaultsRegistry`)
3. **Dynamic Immutability Protection** (`x-immutable: true` checked in `metadata-update.ts`)
4. **OpenSearch Index Mappings** (auto-generated via `scripts/generate-artifacts.ts`)
5. **Frontend UI Presets & Forms** (`window.METADATA_TEMPLATES` auto-generated)

---

## Domain Invariants (Must Never Be Violated)

Before making any change, verify your modifications comply with these rules:

1. **No floating-point money**: Currency values must always be integer minor units (`loan_amount_minor_units` in cents/agorot). Never use `type: "number"`.
2. **Checksums**: Must be SHA-256 formatted as `sha256:<hex>`.
3. **Timestamps**: ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`). Date-only fields use `YYYY-MM-DD`.
4. **Schema inheritance**: All class schemas must use `allOf` with `$ref: "https://bank.internal/schemas/shared-document-metadata-v1.json"`.
5. **Immutability marker**: Any property that cannot be updated after document creation MUST have `"x-immutable": true` in the schema.
6. **Security ratchet**: Never downgrade `confidentiality_tier`, `minimum_clearance_role`, `classification_owner`, or `encryption_requirement` in templates or enrichment logic. `contains_pii: true` and `pii_categories` entries can only be added, never removed.
7. **Annotation schema ID convention**:
   - `loan_agreement` (legacy): `bank.document-metadata/1`
   - All other classes: `bank.document-metadata/<class_name>/<schema_version>` (e.g. `bank.document-metadata/compliance_retention/1`)

---

## The Streamlined Workflow

Because downstream artifacts are automated, modifying metadata is now a 3-step process:

```
[1. Edit / Add Schema]  ──>  [2. Run npm run generate]  ──>  [3. Run npm test]
```

---

### Step 1 — Edit or Create the JSON Schema (`schemas/`)

#### A. Adding or Modifying a Field on an Existing Class
- Edit the corresponding file:
  - `schemas/shared_document_metadata-v1.json` (shared banking traits)
  - `schemas/loan_agreement-v1.json`
  - `schemas/compliance_retention-v1.json`
  - `schemas/security_classification-v1.json`
- **Provide a `"default"` value**: Any field with `"default": ...` is automatically injected into frontend presets and defaulted during document ingest!
- **Mark immutable fields**: If the field cannot be modified via `PATCH /documents/{id}/metadata`, add `"x-immutable": true`.
- **Optional OpenSearch override**: If needed, specify `"x-opensearch-type": "keyword" | "long" | "date"`.

#### B. Adding a Brand-New Document Class
1. Create `schemas/<class_name>-v1.json`:
   ```json
   {
     "$schema": "http://json-schema.org/draft-07/schema#",
     "$id": "bank.document-metadata/<class_name>/1",
     "title": "<ClassNamePascalCase>MetadataV1",
     "allOf": [
       { "$ref": "https://bank.internal/schemas/shared-document-metadata-v1.json" },
       {
         "type": "object",
         "required": ["document_type", "<required_fields>"],
         "properties": {
           "annotation_schema": {
             "type": "string",
             "const": "bank.document-metadata/<class_name>/1"
           },
           "document_class": {
             "type": "string",
             "const": "<class_name>"
           },
           "schema_version": {
             "type": "integer",
             "const": 1
           },
           "document_type": {
             "type": "string",
             "enum": ["<TYPE_A>", "<TYPE_B>"],
             "default": "<TYPE_A>"
           }
         }
       }
     ]
   }
   ```
2. Register the new schema in `src/shared/validator.ts`:
   - Import the schema JSON:
     ```typescript
     import newClassSchema from '../../schemas/<class_name>-v1.json';
     ```
   - Add to `schemaRegistry`, `defaultsRegistry`, and `classSchemas`:
     ```typescript
     schemaRegistry['<class_name>:1'] = ajv.compile(newClassSchema);
     defaultsRegistry['<class_name>:1'] = ajvDefaults.compile(newClassSchema);
     classSchemas['<class_name>'] = newClassSchema;
     ```
3. Add the `<option value="<class_name>">` to the class `<select>` dropdowns in `frontend/index.html`.

---

### Step 2 — Run the Artifact Generator

Run:
```bash
npm run generate
```

This single command triggers `scripts/generate-artifacts.ts` which automatically:
1. **Extracts all defaults** across shared and class schemas and generates:
   - `frontend/generated-templates.js`
   - `frontend/dist/generated-templates.js`
2. **Translates schema types** into OpenSearch Serverless field types and generates:
   - `src/shared/generated-os-mappings.json` (consumed by `src/shared/opensearch.ts`)

---

### Step 3 — Verification & Testing

Run:
```bash
npm test
```

Confirm that:
- TypeScript compilation succeeds (`npm run build`).
- Unit tests pass.
- If needed, regenerate synthetic demo data: `npm run seed`.

---

## Quick Reference: Core Files

| Role | Path | Mechanism |
|---|---|---|
| **Single Source of Truth** | `schemas/*.json` | JSON Schema draft-07 with `default` and `x-immutable` |
| **Artifact Generator** | `scripts/generate-artifacts.ts` | Builds OpenSearch mappings & frontend templates |
| **Validator & Defaults Engine** | `src/shared/validator.ts` | Ajv with `useDefaults: true` and `getImmutableFields()` |
| **Dynamic Immutability Guard** | `src/command-api/metadata-update.ts` | Rejects mutation of any `x-immutable` field |
| **Search Mappings** | `src/shared/generated-os-mappings.json` | Generated from schemas, imported by `opensearch.ts` |
| **Frontend Presets** | `frontend/generated-templates.js` | Generated from schemas, loaded before `app.js` |
