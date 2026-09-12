import * as fs from 'fs';
import * as path from 'path';

const SCHEMAS_DIR = path.resolve(__dirname, '../schemas');
const SHARED_SCHEMA_PATH = path.join(SCHEMAS_DIR, 'shared_document_metadata-v1.json');
const OS_MAPPING_OUTPUT_PATH = path.resolve(__dirname, '../src/shared/generated-os-mappings.json');
const FRONTEND_JS_OUTPUT_PATH = path.resolve(__dirname, '../frontend/generated-templates.js');
const FRONTEND_DIST_JS_OUTPUT_PATH = path.resolve(__dirname, '../frontend/dist/generated-templates.js');

function loadJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function extractDefaults(schema: any): Record<string, any> {
  const defaults: Record<string, any> = {};
  const properties = schema.properties || {};

  for (const [key, prop] of Object.entries(properties as Record<string, any>)) {
    if (prop.default !== undefined) {
      defaults[key] = prop.default;
    } else if (prop.type === 'object' && prop.properties) {
      const nested = extractDefaults(prop);
      if (Object.keys(nested).length > 0) {
        defaults[key] = nested;
      }
    }
  }

  // Also check allOf
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      if (sub.properties) {
        Object.assign(defaults, extractDefaults(sub));
      }
    }
  }

  return defaults;
}

function jsonSchemaPropToOpenSearch(propName: string, prop: any): any {
  if (prop['x-opensearch-type']) {
    return { type: prop['x-opensearch-type'] };
  }

  if (prop.type === 'object' && prop.properties) {
    const subProperties: Record<string, any> = {};
    for (const [subKey, subProp] of Object.entries(prop.properties)) {
      subProperties[subKey] = jsonSchemaPropToOpenSearch(subKey, subProp);
    }
    return { properties: subProperties };
  }

  if (
    propName.endsWith('_date') ||
    propName.endsWith('_dttm') ||
    propName.endsWith('_at') ||
    prop.format === 'date' ||
    prop.format === 'date-time'
  ) {
    return {
      type: 'date',
      format: 'yyyy-MM-dd||strict_date_optional_time||epoch_millis',
    };
  }

  if (prop.type === 'integer') {
    if (
      propName.includes('amount') ||
      propName.includes('subscription') ||
      propName.includes('customer_id') ||
      propName.includes('account_number')
    ) {
      return { type: 'long' };
    }
    return { type: 'integer' };
  }

  if (prop.type === 'number') {
    return { type: 'double' };
  }

  if (prop.type === 'boolean') {
    return { type: 'boolean' };
  }

  // Default string or string enum or array of strings
  return { type: 'keyword' };
}

function generateOpenSearchMappings(): Record<string, any> {
  const standardSystemProperties: Record<string, any> = {
    document_id: { type: 'keyword' },
    document_class: { type: 'keyword' },
    filename: { type: 'keyword' },
    status: { type: 'keyword' },
    application_version: { type: 'integer' },
    metadata_revision: { type: 'integer' },
    content_type: { type: 'keyword' },
    format: { type: 'keyword' },
    page_count: { type: 'integer' },
    content_length: { type: 'long' },
    created_at: { type: 'date' },
    updated_at: { type: 'date' },
    projection_timestamp: { type: 'date' },
  };

  const allProperties: Record<string, any> = { ...standardSystemProperties };

  // 1. Shared schema properties
  const sharedSchema = loadJson(SHARED_SCHEMA_PATH);
  for (const [key, prop] of Object.entries(sharedSchema.properties as Record<string, any>)) {
    // skip system properties already mapped above
    if (allProperties[key]) continue;
    allProperties[key] = jsonSchemaPropToOpenSearch(key, prop);
  }

  // 2. Class schemas properties
  const schemaFiles = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('shared_'));
  for (const file of schemaFiles) {
    const classSchema = loadJson(path.join(SCHEMAS_DIR, file));
    const schemasToCheck = [classSchema, ...(classSchema.allOf || [])];
    for (const sub of schemasToCheck) {
      if (sub.properties) {
        for (const [key, prop] of Object.entries(sub.properties as Record<string, any>)) {
          if (allProperties[key]) continue;
          allProperties[key] = jsonSchemaPropToOpenSearch(key, prop);
        }
      }
    }
  }

  return {
    mappings: {
      properties: allProperties,
    },
  };
}

function generateFrontendTemplates() {
  const sharedSchema = loadJson(SHARED_SCHEMA_PATH);
  const sharedDefaults = extractDefaults(sharedSchema);

  const classSpecificTemplates: Record<string, any> = {};
  const metadataTemplates: Record<string, any> = {};

  const schemaFiles = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('shared_'));

  for (const file of schemaFiles) {
    const classSchema = loadJson(path.join(SCHEMAS_DIR, file));
    let docClass = '';
    const schemasToCheck = [classSchema, ...(classSchema.allOf || [])];
    for (const sub of schemasToCheck) {
      if (sub.properties?.document_class?.const) {
        docClass = sub.properties.document_class.const;
      }
    }
    if (!docClass) {
      docClass = file.replace(/-v\d+\.json$/, '').replace(/\.json$/, '');
    }

    const classDefaults = extractDefaults(classSchema);
    // Remove document_class, schema_version, annotation_schema from templates to keep them clean
    delete classDefaults.document_class;
    delete classDefaults.schema_version;
    delete classDefaults.annotation_schema;

    classSpecificTemplates[docClass] = classDefaults;
    metadataTemplates[docClass] = {
      ...sharedDefaults,
      ...classDefaults,
    };
  }

  const jsContent = `/**
 * Auto-generated by scripts/generate-artifacts.ts
 * DO NOT EDIT MANUALLY. To update defaults, update the corresponding JSON Schema in schemas/
 */
window.SHARED_BASE_TEMPLATE = ${JSON.stringify(sharedDefaults, null, 2)};

window.CLASS_SPECIFIC_TEMPLATES = ${JSON.stringify(classSpecificTemplates, null, 2)};

window.METADATA_TEMPLATES = ${JSON.stringify(metadataTemplates, null, 2)};
`;

  fs.writeFileSync(FRONTEND_JS_OUTPUT_PATH, jsContent, 'utf-8');
  console.log(`Generated frontend templates: ${FRONTEND_JS_OUTPUT_PATH}`);

  if (fs.existsSync(path.dirname(FRONTEND_DIST_JS_OUTPUT_PATH))) {
    fs.writeFileSync(FRONTEND_DIST_JS_OUTPUT_PATH, jsContent, 'utf-8');
    console.log(`Generated frontend dist templates: ${FRONTEND_DIST_JS_OUTPUT_PATH}`);
  }
}

function syncFrontendDist() {
  const frontendDir = path.resolve(__dirname, '../frontend');
  const distDir = path.resolve(__dirname, '../frontend/dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const filesToCopy = ['app.js', 'index.html', 'styles.css', 'cost_calculator.html', 'config.json'];
  for (const file of filesToCopy) {
    const src = path.join(frontendDir, file);
    const dest = path.join(distDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`Synced ${file} -> frontend/dist/${file}`);
    }
  }
}

function main() {
  console.log('Generating OpenSearch mappings...');
  const osMappings = generateOpenSearchMappings();
  fs.writeFileSync(OS_MAPPING_OUTPUT_PATH, JSON.stringify(osMappings, null, 2), 'utf-8');
  console.log(`Generated OpenSearch mappings: ${OS_MAPPING_OUTPUT_PATH}`);

  console.log('Generating Frontend metadata templates...');
  generateFrontendTemplates();

  console.log('Syncing frontend/dist assets...');
  syncFrontendDist();

  console.log('Artifact generation complete!');
}

main();
