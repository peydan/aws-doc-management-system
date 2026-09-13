---
name: impact-analysis
description: Perform comprehensive blast-radius and dependency impact analysis across all repository layers when planning or executing architectural, schema, or API changes. Use whenever modifying domain models, schemas, database keys, API endpoints, or data flows.
---

# Change Impact Analysis & Blast Radius Skill

Use this skill whenever a change is proposed to an entity, schema, API contract, database model, or pipeline to systematically identify every dependent artifact.

---

## 6-Layer Impact Analysis Checklist

When examining the impact of a change, evaluate each of the 6 architectural layers in order:

```
[Layer 1: Schemas & Contracts] (Single Source of Truth)
         ↓
[Layer 2: Validation & Compute] (Ajv defaultsRegistry & getImmutableFields)
         ↓
[Layer 3: Asynchronous Projection & Search] (generated-os-mappings.json)
         ↓
[Layer 4: Client & Frontend UI] (generated-templates.js & app.js)
         ↓
[Layer 5: Test Suites & Demo Datasets] (Jest & seed-demo-dataset.ts)
         ↓
[Layer 6: Architecture Specs, Decks & Diagrams] (SYSTEM_CAPABILITIES.md & Specs)
```

---

### Layer 1: Schemas & API Contracts (Single Source of Truth)
* [ ] **JSON Schemas (`schemas/*.json`)**:
  * Did any field name, type, enum, or `required` constraint change?
  * Does the change affect base schema inheritance (`allOf`, `$ref: "https://bank.internal/schemas/shared-document-metadata-v1.json"`)?
  * Are `"default"` values declared in schema for new/modified fields (used to automatically generate UI templates and populate defaults on ingest)?
  * Are immutable fields tagged with `"x-immutable": true` (used to automatically enforce immutability on metadata updates)?
  * Is an explicit search indexing override needed via `"x-opensearch-type"`?
* [ ] **OpenAPI Specifications (`openapi.yaml`, `openapi.json`)**:
  * Are component schemas, request bodies, and response envelopes updated?
  * Are both YAML and JSON representations synchronized?
* [ ] **API Collections (`postman_collection.json`)**:
  * Do sample request payloads reflect the new payload structure?

---

### Layer 2: Validation & Business Logic (Backend / Lambdas)
* [ ] **Validation & Defaults Engine (`src/shared/validator.ts`)**:
  * For new document classes: Are they registered in `schemaRegistry`, `defaultsRegistry`, and `classSchemas`?
  * Does `defaultsRegistry` automatically apply defaults via Ajv `useDefaults: true` (no hardcoding needed in `buildFullMetadata()`)?
  * Does `getImmutableFields(documentClass)` dynamically extract all fields tagged with `"x-immutable": true`?
* [ ] **Command & Query Handlers (`src/command-api/*`, `src/query-api/*`)**:
  * Does `metadata-update.ts` enforce immutability dynamically via `getImmutableFields()`?
  * Do upload/version handlers handle new parameters?
* [ ] **DynamoDB Key & OCC Invariants (`src/shared/dynamo.ts`)**:
  * Does the change impact Partition Keys (`pk`), Sort Keys (`sk`), or Optimistic Concurrency Control checks?

---

### Layer 3: Search Projection & Async Streams
* [ ] **OpenSearch Serverless (`src/shared/opensearch.ts`, `src/shared/generated-os-mappings.json`)**:
  * Was `npm run generate` run to rebuild `src/shared/generated-os-mappings.json` directly from schemas?
  * Are search query filters and sorting parameters updated in `src/query-api/search-documents.ts`?
* [ ] **Stream Workers & Indexers (`src/background-worker/indexer.ts`)**:
  * Does the worker correctly extract and transform the modified attributes?

---

### Layer 4: Client & Frontend User Interface
* [ ] **Frontend Presets (`frontend-react/src/generated/templates.ts`)**:
  * Was `npm run generate` run to rebuild `METADATA_TEMPLATES` and `CLASS_SPECIFIC_TEMPLATES` directly from schema defaults?
* [ ] **React Components (`frontend-react/src/components/*`)**:
  * For new classes: Are class options, search filters, and table columns updated?
  * Does `frontend-react` build cleanly via `npm run build:react`?
* [ ] **Client State & API Client (`frontend-react/src/api/client.ts`)**:
  * Does the client handle any new API contracts, methods, or parameters?

---

### Layer 5: Test Suites & Demo Datasets
* [ ] **Unit Tests (`test/unit/*.test.ts`)**:
  * Are test fixtures and validation mocks updated?
* [ ] **Synthetic Dataset Generator (`scripts/seed-demo-dataset.ts`)**:
  * Does the generator produce valid records conforming to the updated schema?
* [ ] **Demo Data (`dist/demo_dataset.json`)**:
  * Has the dataset been regenerated (`npm run seed`)?

---

### Layer 6: Specifications, Diagrams & Presentation Assets
* [ ] **System Capabilities Catalog (`SYSTEM_CAPABILITIES.md`)**:
  * Are newly exposed capabilities, endpoints, parameters, RBAC roles, or payload contracts reflected in the capability matrix and detailed catalog?
  * Did any existing capability behavior, payload limit, or storage authority boundary change?
  * Are all exposable interfaces, error codes, and operational flows kept in exact sync with implementation?
* [ ] **Domain Guidelines (`AGENTS.md`, `.agents/skills/domain-ontology/SKILL.md`)**:
  * Are domain trait hierarchies and key patterns updated?
* [ ] **Architecture Specifications (`SOLUTION_ARCHITECTURE_SPECIFICATION.md`)**:
  * Are design chapters, payload examples, and table matrices kept in sync?
  * Are all exposed endpoints documented with corresponding Mermaid sequence flows?
  * Is the CDK stack dependency graph updated to reflect all active infrastructure stacks?
* [ ] **Cost Analysis & Sizing Calculator (`COST_ANALYSIS_AND_ESTIMATION_ISRAEL_REGION.md`, `presentations/cost_calculator.html`)**:
  * Did any architectural component, service rate, compute runtime, or storage lifecycle change?
  * Are new services or pipelines (e.g., Amazon Bedrock AI enrichment/assistant, transient batch export archives, on-demand conversion derivatives, S3 audit logs) represented in the pricing catalog and interactive sizing models?
  * Are workload sizing presets (`poc`, `mid`, `enterprise`, `archive`) synchronized between specification documents and the interactive HTML calculator?
  * Is the interactive calculator free of syntax errors and executable in standard browser environments?
* [ ] **Architecture & Integration Diagrams (`presentations/diagrams/*.drawio`)**:
  * **High-Level Solution Architecture (`aws_document_management_architecture.drawio`)**: Are newly introduced services (Bedrock, SQS queues, Lambdas, S3 prefixes) and data-path flows reflected? Has the updated diagram been re-exported to `.png` via draw.io CLI?
  * **UI & Backend Integration Architecture (`ui_backend_integration_architecture.drawio`)**: Are all active workspace tabs, REST route cards, client SDK flows, and compute Lambdas up to date? Have `.png` and `.svg` renders been rebuilt?
* [ ] **API Sequence Diagrams (`presentations/diagrams/api_sequence_diagrams/`)**:
  * Are all exposed REST API endpoints and background event workflows authored as standalone `.drawio` files?
  * Are new sequence diagrams appended as individual tabs in the master workbook (`all_api_sequence_diagrams.drawio`)?
  * Have high-resolution `.jpg` raster images been re-rendered via the draw.io CLI for all created/modified sequence diagrams?
* [ ] **Slide Presentations & Deck Generators**:
  * `presentations/*.html`: Are interactive slides, capabilities lists, and code blocks updated?
  * `presentations/generate_deck.py` & `generate_deck_hebrew.py`: Are sequence diagram slide generators and breakdown cards updated to embed newly created `.jpg` assets?
  * Have both `.pptx` decks (`AWS_Document_Management_Platform_Architecture.pptx` and Hebrew edition) been rebuilt and verified?


---

## Step-by-Step Investigation Workflow for Agents

1. **Grep Pattern Search**:
   ```bash
   # Search for all references to the modified symbol or field
   grep_search Query="<fieldName>" SearchPath="."
   ```
2. **Schema & Contract Check**:
   Review all files in `schemas/`, `openapi.yaml`, and `src/shared/validator.ts`. Ensure `"default"` and `"x-immutable"` are set in schema.
3. **Run Code Generation, Build & Test**:
   ```bash
   # npm run build automatically runs 'npm run generate' to update mappings & templates before tsc
   npm run build && npm test
   ```
4. **Produce Impact Summary**:
   List affected files by layer, detailing what needs code changes, test updates, or re-generation.
