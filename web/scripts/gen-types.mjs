// src/api/schema.json (from `solosquad web schema`) → src/api/types.gen.ts (PRD v2.1.0 I6).
// The web never hand-writes an API type: change the pydantic models, then `npm run gen`.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const schema = JSON.parse(await readFile(here('../src/api/schema.json'), 'utf8'));

const ts = await compile(schema, 'SoloSquadWebApi', {
  bannerComment:
    '/* eslint-disable */\n/**\n * Generated from src/api/schema.json by scripts/gen-types.mjs — do not edit.\n' +
    ' * Source of truth: python/src/solosquad/web_api/schemas.py (`npm run gen`).\n */',
  additionalProperties: false,
  unreachableDefinitions: true,
  declareExternallyReferenced: true,
  enableConstEnums: false,
  format: true,
  style: { singleQuote: true, printWidth: 100 },
});

await writeFile(here('../src/api/types.gen.ts'), ts);
console.log('wrote src/api/types.gen.ts');
