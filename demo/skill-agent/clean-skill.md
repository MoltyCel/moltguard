# moltrust-demo-skill

A demonstration skill for MolTrust's MT Skill Verification system.

## Purpose

This skill demonstrates the structure and metadata requirements for a
well-formed AI agent skill that passes MolTrust's security audit.
It formats text and validates JSON schemas.

## Version

1.0.0

## Author

MolTrust (did:base:0x380238347e58435f40B4da1F1A045A271D5838F5)

## Capabilities

- Text formatting and template rendering
- JSON schema validation
- Markdown-to-HTML conversion

## Tools

### format_text
Formats input text according to a specified template.
- Input: { text: string, template: string }
- Output: { formatted: string }

### validate_schema
Validates a JSON object against a JSON Schema.
- Input: { data: object, schema: object }
- Output: { valid: boolean, errors: string[] }

## License

MIT
