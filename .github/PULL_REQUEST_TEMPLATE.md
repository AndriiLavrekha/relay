## Summary

<!-- Explain what this change does and why. -->

## Related Issues

<!-- Link any related issues (e.g., Closes #123). -->

## Validation Checklist

- [ ] `npm test` passes
- [ ] `npm run smoke` passes across `claude-code`, `codex`, and `gemini`
- [ ] `npm run bundle:plugins` ran if `src/`, `bin/`, `assets/`, or `plugins/gemini/skills/` changed
- [ ] `npm pack --dry-run` includes only intended files
- [ ] Updated documentation / protocol specs if behavior or CLI flags changed
