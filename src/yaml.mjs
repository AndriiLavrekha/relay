import { AtbError } from './errors.mjs';

// JSON is a valid subset of YAML 1.2. Protocol-critical front matter uses this
// deterministic subset so the runtime has no third-party YAML dependency.
export function stringifyYaml(value) {
  return JSON.stringify(value, null, 2);
}

export function parseYaml(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AtbError('INVALID_YAML_SUBSET', `Expected JSON-compatible YAML: ${error.message}`);
  }
}
