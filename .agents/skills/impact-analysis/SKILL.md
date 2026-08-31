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
[Layer 1: Schemas & Contracts]
         ↓
[Layer 2: Validation & Compute]
         ↓
[Layer 3: Asynchronous Projection & Search]
         ↓
[Layer 4: Client & Frontend UI]
         ↓
[Layer 5: Test Suites & Demo Datasets]
         ↓
[Layer 6: Architecture Specs, Decks & Diagrams]
```

---

### Layer 1: Schemas & API Contracts
* [ ] **JSON Schemas (`schemas/*.json`)**:
  * Did any field name, type, enum, or `required` constraint change?
  * Does the change affect base schema inheritance (`allOf`, `$ref`)?
* [ ] **OpenAPI Specifications (`openapi.yaml`, `openapi.json`)**:
  * Are component schemas, request bodies, and response envelopes updated?
  * Are both YAML and JSON representations synchronized?
* [ ] **API Collections (`postman_collection.json`)**:
  * Do sample request payloads reflect the new payload structure?

---

### Layer 2: Validation & Business Logic (Backend / Lambdas)
* [ ] **Validation Registry (`src/shared/validator.ts`)**:
  * Are new schemas compiled in Ajv?
  * Does `buildFullMetadata()` supply default values for newly required fields?
* [ ] **Command & Query Handlers (`src/command-api/*`, `src/query-api/*`)**:
  * Are immutable fields protected against mutation in `metadata-update.ts`?
  * Do upload/version handlers handle new parameters?
* [ ] **DynamoDB Key & OCC Invariants (`src/shared/dynamo.ts`)**:
  * Does the change impact Partition Keys (`pk`), Sort Keys (`sk`), or Optimistic Concurrency Control checks?

---

### Layer 3: Search Projection & Async Streams
* [ ] **OpenSearch Serverless (`src/shared/opensearch.ts`)**:
  * Are index mappings updated with new field types (keywords, numbers, dates, nested objects)?
  * Are search query filters and sorting parameters updated?
* [ ] **Stream Workers & Indexers (`src/background-worker/indexer.ts`)**:
  * Does the worker correctly extract and transform the modified attributes?

---

### Layer 4: Client & Frontend User Interface
* [ ] **HTML Forms & Templates (`frontend/index.html`)**:
  * Are sample JSON snippets in upload/ingest forms updated?
  * Are new search input filters and table headers added?
* [ ] **Client Logic (`frontend/app.js`)**:
  * Are template dictionaries (`METADATA_TEMPLATES`) and serialization functions updated?
* [ ] **Distribution Bundle (`frontend/dist/`)**:
  * Are updated assets synchronized to the build directory?

---

### Layer 5: Test Suites & Demo Datasets
* [ ] **Unit Tests (`test/unit/*.test.ts`)**:
  * Are test fixtures and validation mocks updated?
* [ ] **Synthetic Dataset Generator (`scripts/seed-demo-dataset.ts`)**:
  * Does the generator produce valid records conforming to the updated schema?
* [ ] **Demo Data (`dist/demo_dataset.json`)**:
  * Has the dataset been regenerated?

---

### Layer 6: Specifications, Diagrams & Presentation Assets
* [ ] **Domain Guidelines (`AGENTS.md`, `.agents/skills/domain-ontology/SKILL.md`)**:
  * Are domain trait hierarchies and key patterns updated?
* [ ] **Architecture Specifications (`SOLUTION_ARCHITECTURE_SPECIFICATION.md`)**:
  * Are design chapters, payload examples, and table matrices kept in sync?
* [ ] **Slide Presentations & Scripts**:
  * `presentations/*.html`: Are interactive slides and code blocks updated?
  * `presentations/generate_deck.py` / `generate_deck_hebrew.py`: Are PowerPoint generator tables updated and `.pptx` decks rebuilt?
  * Sequence Diagrams (`presentations/diagrams/**/*.drawio`): Are payload annotations updated?

---

## Step-by-Step Investigation Workflow for Agents

1. **Grep Pattern Search**:
   ```bash
   # Search for all references to the modified symbol or field
   grep_search Query="<fieldName>" SearchPath="."
   ```
2. **Schema & Contract Check**:
   Review all files in `schemas/`, `openapi.yaml`, and `src/shared/validator.ts`.
3. **Run Build & Test**:
   ```bash
   npm run build && npm test
   ```
4. **Produce Impact Summary**:
   List affected files by layer, detailing what needs code changes, test updates, or re-generation.
