'use strict';

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { catalog } = require('../../shared/mcp-contracts/catalog');

class CatalogValidator {
  constructor() {
    this.ajv = new Ajv2020({ allErrors: false, strict: true, useDefaults: true, coerceTypes: false });
    addFormats(this.ajv);
    this.validators = new Map();
    for (const [name, tool] of Object.entries(catalog.tools)) {
      this.validators.set(`${name}:input`, this.ajv.compile({ $schema: catalog.$schema, $defs: catalog.$defs, ...tool.inputSchema }));
      this.validators.set(`${name}:output`, this.ajv.compile({ $schema: catalog.$schema, $defs: catalog.$defs, ...tool.outputSchema }));
    }
  }

  validateInput(name, value) { return this.validate(`${name}:input`, value, 'INVALID_REQUEST'); }
  validateOutput(name, value) { return this.validate(`${name}:output`, value, 'INTERNAL_ERROR'); }
  validate(key, value, code) {
    const validator = this.validators.get(key);
    if (!validator) throw typedError('CAPABILITY_UNAVAILABLE');
    const candidate = structuredClone(value);
    if (!validator(candidate)) throw typedError(code);
    return candidate;
  }
}

function typedError(code) { const error = new Error(code); error.code = code; return error; }
module.exports = { CatalogValidator, typedError };
