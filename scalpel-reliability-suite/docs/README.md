# Scalpel Reliability Suite

A comprehensive test project for validating MCP file-editing tools.

## Overview

This project is designed to exercise every file-editing operation in realistic,
adversarial conditions. It contains multiple languages, deeply nested directories,
edge-case files, and deliberately ambiguous content.

## Structure

- `src/` — TypeScript and Python source files
- `docs/` — Markdown documentation
- `config/` — Configuration files (INI, YAML, TOML, JSON)
- `fixtures/` — Edge-case test files
- `nested/` — Deeply nested directory tree
- `logs/` — Log files
- `generated/` — Auto-generated code regions

## Installation

No external dependencies are required. This is a self-contained fixture project.

```bash
# Simply browse the files
ls -R scalpel-reliability-suite/
```

## Usage

Use this project to test MCP tools such as:

- `read` — Read file contents
- `stat` — Get file metadata
- `list_dir` — List directory contents
- `grep` — Search file contents
- `create` — Create new files
- `patch` — Replace exact string matches
- `batch_edit` — Apply multiple patches atomically
- `insert` — Insert content at specific lines or markers
- `delete_range` — Delete line ranges or marker-bounded blocks
- `replace_between_markers` — Replace content between markers
- `append` — Append content to end of file
- `prepend` — Prepend content to beginning of file
- `diff` — Compute unified diffs
- `move` — Move or rename files

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## API Reference

See [API.md](./API.md) for endpoint documentation.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

---

## Long Paragraph Section

This section contains a very long paragraph to test reading behavior with content
that does not break cleanly into short lines. When an MCP tool reads this file, it
should return the full text without truncation or unexpected wrapping. Lorem ipsum
dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut
labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation
ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in
reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt
mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit
voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae
ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.
Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia
consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro
quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed
quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam
quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam
corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur. Quis autem
vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae
consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur. At vero
eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium
voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint
occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt
mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et
expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque
nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas
assumenda est, omnis dolor repellendus. Temporibus autem quibusdam et aut officiis
debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et
molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut
reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus
asperiores repellat. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam,
quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa
qui officia deserunt mollit anim id est laborum.

## Repeated Heading Pattern

### Section Alpha

Content for section alpha.

### Section Beta

Content for section beta.

### Section Gamma

Content for section gamma.

### Section Delta

Content for section delta.

### Section Epsilon

Content for section epsilon.

## Configuration Example

```json
{
  "name": "scalpel-reliability-suite",
  "version": "1.0.0",
  "private": true
}
```

## Marker Test Region

<!-- BEGIN GENERATED SECTION -->
This content is generated automatically.
Do not modify it manually.
Version: 1.0.0
<!-- END GENERATED SECTION -->

## Another Marker Test Region

<!-- BEGIN GENERATED SECTION -->
This content is also generated automatically.
It serves a different purpose than the first region.
Version: 1.0.1
<!-- END GENERATED SECTION -->
