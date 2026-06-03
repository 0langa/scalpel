# Testing Notes

This document describes every important file in the `scalpel-reliability-suite` and explains which edge cases it covers and which MCP tools it is especially useful for testing.

---

## `src/app.ts` — Large TypeScript File

**Purpose:** Stress-tests `read`, `patch`, `insert`, `delete_range`, and `replace_between_markers` on a large, realistic TypeScript source file.

**Edge cases covered:**
- Large file size (~9 KB, 300+ lines)
- Repeated function definitions with similar names (`formatDate`, `formatDateShort`, `formatDateLong`)
- Repeated utility modules (FileOperations, Validation, Logging, Retry Logic, String Utilities, Array Utilities, Object Utilities)
- Multiple distinct marker regions (`BEGIN CONFIG BLOCK`, `END CONFIG BLOCK`, `BEGIN API BLOCK`, `END API BLOCK`)
- Duplicate `BEGIN GENERATED SECTION` / `END GENERATED SECTION` pairs (tests whether tools correctly target the first, last, or a specific occurrence)
- Import statements and export blocks

**Best tools to test:**
- `read` — verify full content retrieval without truncation
- `patch` — replace specific functions or imports
- `insert` — add new functions between existing modules
- `delete_range` — remove an entire module block by line range
- `replace_between_markers` — regenerate content inside `BEGIN GENERATED SECTION`
- `grep` — search for repeated function names

---

## `src/utils.ts` — Ambiguity Testing File

**Purpose:** Exercises `grep` and `patch` on ambiguous content where multiple identical or near-identical matches exist.

**Edge cases covered:**
- Duplicated exact strings (`STATUS_OK`, `STATUS_OK_V2`, `STATUS_OK_LEGACY` all equal `"status: ok"`)
- Duplicated exact function bodies with different signatures (`handleRequest` vs `handleRequestLegacy`)
- Repeated `TODO` and `FIXME` lines (three exact copies each)
- Similar function names (`getUser`, `getUserById`, `getUserProfile`, `getUserSettings`, `getUserPreferences`)

**Best tools to test:**
- `grep` — verify whether it finds all occurrences, returns context, or handles duplicates
- `patch` — verify whether replacing `"status: ok"` replaces the first, all, or errors out
- `batch_edit` — apply multiple patches that may have overlapping or ambiguous matches

---

## `src/config.py` — Large Python File

**Purpose:** Tests editing operations on Python syntax with significant indentation, docstrings, and generated regions.

**Edge cases covered:**
- Large file size (~10 KB, 300+ lines)
- Python indentation (classes, methods, nested blocks)
- Docstrings with triple quotes
- Multiple `BEGIN GENERATED SECTION` / `END GENERATED SECTION` pairs
- `BEGIN CONFIG BLOCK` / `END CONFIG BLOCK` and `BEGIN API BLOCK` / `END API BLOCK`
- Class inheritance and method overriding

**Best tools to test:**
- `read` — verify docstrings and indentation are preserved
- `patch` — replace a method body without breaking indentation
- `insert` — add a new method inside a class
- `delete_range` — remove an entire class definition
- `replace_between_markers` — update generated functions

---

## `src/helpers.py` — Tiny File

**Purpose:** Tests minimal-content edge cases.

**Edge cases covered:**
- Very small file (2 lines, 32 bytes)
- Single function definition

**Best tools to test:**
- `read` — verify small files are returned completely
- `stat` — verify metadata for tiny files
- `patch` — replace the entire content easily
- `prepend` / `append` — add content and verify order

---

## `src/data.json` — Large JSON File

**Purpose:** Stress-tests `read` and `patch` on structured JSON with nested objects and arrays.

**Edge cases covered:**
- Large nested JSON (~3.5 KB)
- Arrays of objects (`modules`, `environments`, `users`, `auditLog`)
- Deep nesting (`environments[].database.host`)
- Repeated object shapes across array elements

**Best tools to test:**
- `read` — verify JSON structure is preserved
- `patch` — update a specific nested value
- `grep` — search for repeated keys or values

---

## `src/empty.ts` — Empty File

**Purpose:** Tests behavior on zero-byte files.

**Edge cases covered:**
- Completely empty file (0 bytes)
- No lines, no content

**Best tools to test:**
- `read` — verify empty string is returned
- `stat` — verify size is 0
- `append` — add first content to previously empty file
- `prepend` — same behavior as append for empty file

---

## `src/types.d.ts` — Long Lines File

**Purpose:** Tests `read`, `diff`, and `patch` when single lines exceed typical widths.

**Edge cases covered:**
- Very long single-line type definitions (exceeding 200 characters)
- Long union types and interface definitions
- Minified-style long lines in a source file

**Best tools to test:**
- `read` — verify long lines are not truncated or wrapped
- `diff` — compute diff after modifying a long line
- `patch` — replace a long line exactly

---

## `docs/README.md` — Large Markdown File

**Purpose:** Tests `read`, `patch`, and `replace_between_markers` on documentation with mixed formatting.

**Edge cases covered:**
- Large Markdown with headings, code blocks, long paragraphs
- Repeated heading patterns (`Section Alpha` through `Section Epsilon`)
- Duplicate HTML-style markers (`<!-- BEGIN GENERATED SECTION -->` appearing twice)
- Long paragraph without line breaks (tests paragraph-level reading)

**Best tools to test:**
- `read` — verify headings and code blocks are preserved
- `patch` — replace a heading or paragraph
- `replace_between_markers` — update generated documentation regions
- `grep` — search for repeated headings

---

## `docs/CONTRIBUTING.md` — Repeated Strings File

**Purpose:** Tests `grep` and `patch` on deliberately repeated content.

**Edge cases covered:**
- Repeated `TODO` lines (3 identical copies)
- Repeated `FIXME` lines (3 identical copies)
- Repeated marker strings (`marker-string-alpha`, `marker-string-beta`, `marker-string-gamma`) interleaved

**Best tools to test:**
- `grep` — verify all matches are found and returned with line numbers
- `patch` — replace one specific occurrence of a repeated string
- `batch_edit` — replace multiple repeated strings in one operation

---

## `docs/API.md` — Marker-Based File

**Purpose:** Tests `replace_between_markers` on files with multiple identical marker pairs.

**Edge cases covered:**
- Two distinct `BEGIN API BLOCK` / `END API BLOCK` regions
- Content between markers is different, but markers themselves are identical

**Best tools to test:**
- `replace_between_markers` — verify whether the tool targets the first, last, or all regions
- `insert` — add content before or after a marker
- `read` — verify marker regions are readable

---

## `docs/CHANGELOG.md` — Append/Prepend Target

**Purpose:** Designed for `append` and `prepend` testing.

**Edge cases covered:**
- Structured version history
- Clear top and bottom boundaries

**Best tools to test:**
- `append` — add a new version entry to the bottom
- `prepend` — add a new version entry to the top
- `read` — verify order after append/prepend

---

## `config/settings.ini` — Ambiguous Config File

**Purpose:** Tests `grep` and `patch` on INI-style files with repeated sections and keys.

**Edge cases covered:**
- Duplicate section names (`[database]` appears twice, `[cache]` appears twice, `[worker]` appears twice)
- Keys repeated in comments and body (`host = localhost` appears in comments and multiple sections)
- Similar keys across sections (`host`, `port`)

**Best tools to test:**
- `grep` — search for keys and verify all matches are returned
- `patch` — replace a key in a specific section
- `read` — verify INI structure is preserved

---

## `config/deployment.yaml` — YAML Marker File

**Purpose:** Tests `replace_between_markers` on YAML with nested structures.

**Edge cases covered:**
- Two `BEGIN CONFIG BLOCK` / `END CONFIG BLOCK` regions containing valid YAML
- YAML indentation inside markers
- Multiple YAML documents separated by `---`

**Best tools to test:**
- `replace_between_markers` — update a deployment spec inside markers
- `read` — verify YAML indentation is preserved
- `patch` — replace a specific YAML value

---

## `config/pyproject.toml` — TOML Config File

**Purpose:** Tests `read` and `patch` on TOML-style configuration.

**Edge cases covered:**
- Tables and nested tables (`[tool.pytest.ini_options]`, `[tool.ruff.pydocstyle]`)
- Arrays of strings (`select = ["E", "F", ...]`)
- Inline tables (`license = { text = "MIT" }`)
- Mixed content types (build system, project metadata, tool configs)

**Best tools to test:**
- `read` — verify TOML structure is preserved
- `patch` — update a dependency version or tool setting
- `grep` — search for repeated table names

---

## `config/manifest.json` — JSON Config File

**Purpose:** Tests `read` and `patch` on a flat but structurally meaningful JSON file.

**Edge cases covered:**
- Arrays of objects (`permissions`, `content_scripts`)
- Nested objects (`background`, `options_ui`, `icons`)
- String values with special characters (`content_security_policy`)

**Best tools to test:**
- `read` — verify JSON structure
- `patch` — replace a nested value
- `diff` — compute diff after patch

---

## `fixtures/repeated-strings.txt` — Extreme Repetition

**Purpose:** Stress-tests `grep` and `patch` on files with extreme repetition.

**Edge cases covered:**
- 100 lines of only three unique strings (`alpha`, `beta`, `gamma`) in strict rotation
- Every line is an exact duplicate of two other lines (modulo position)

**Best tools to test:**
- `grep` — search for `alpha` and verify 33+ matches
- `patch` — replace one occurrence and verify only that line changed
- `batch_edit` — replace multiple strings atomically

---

## `fixtures/numbered-lines.txt` — Line-Number Verification

**Purpose:** Provides an easy way to verify `delete_range`, `insert`, and `read` line boundaries.

**Edge cases covered:**
- 50 sequentially numbered lines
- Fixed-width line numbers (`001 |` through `050 |`)

**Best tools to test:**
- `read` — read specific line ranges and verify line numbers
- `delete_range` — delete lines 10-20 and verify the gap
- `insert` — insert after line 25 and verify new content appears at the correct position
- `patch` — replace a numbered line and verify the replacement

---

## `fixtures/long-lines.txt` — Very Long Single Lines

**Purpose:** Tests `read`, `diff`, and `patch` when individual lines exceed typical widths.

**Edge cases covered:**
- Line with no spaces (single long token)
- Line with 500+ repeated `A` characters
- Minified JSON on a single line
- Mix of short and very long lines

**Best tools to test:**
- `read` — verify no truncation or wrapping
- `diff` — compute diff after modifying a long line
- `patch` — replace a very long line exactly

---

## `fixtures/mixed-newlines.txt` — Mixed Line Endings

**Purpose:** Tests `read` and `patch` behavior when a file contains mixed CRLF and LF line endings.

**Edge cases covered:**
- Alternating CRLF (`\r\n`) and LF (`\n`) line endings
- Windows-style and Unix-style endings in the same file

**Best tools to test:**
- `read` — verify line endings are preserved as-is or normalized consistently
- `patch` — replace a line and verify surrounding line endings are not corrupted
- `diff` — compute diff and verify line ending changes are visible

---

## `fixtures/ambiguous-markers.txt` — Duplicate Markers

**Purpose:** Tests `replace_between_markers` when the same marker pair appears multiple times.

**Edge cases covered:**
- Four identical `BEGIN SECTION` / `END SECTION` pairs
- One unique `BEGIN UNIQUE` / `END UNIQUE` pair for contrast

**Best tools to test:**
- `replace_between_markers` — verify behavior when markers are duplicated (first match? error?)
- `insert` — insert before or after a duplicated marker
- `delete_range` — delete content bounded by duplicated markers

---

## `fixtures/tiny.txt` — Single Line File

**Purpose:** Tests minimal non-empty file behavior.

**Edge cases covered:**
- Single line with no trailing newline (or with trailing newline, depending on tool)
- Smallest possible meaningful file

**Best tools to test:**
- `read` — verify single line is returned
- `stat` — verify size is minimal
- `patch` — replace the only line
- `append` — add a second line
- `prepend` — add a line before the first

---

## `fixtures/large-content.md` — Very Large Markdown

**Purpose:** Stress-tests `read` on a very large file (~12 KB, 100+ sections).

**Edge cases covered:**
- 100 numbered sections
- Large overall file size
- Repetitive structure (tests whether tools handle repetition efficiently)

**Best tools to test:**
- `read` — verify full file is returned without truncation
- `read` (with line range) — read a subset of lines from a large file
- `grep` — search for a specific section number
- `patch` — replace a section deep in the file

---

## `fixtures/move-source.txt` — Move/Rename Target

**Purpose:** Designed for `move` testing.

**Edge cases covered:**
- Multi-line file with clear content
- Exists to be moved to a new location or renamed

**Best tools to test:**
- `move` — rename or relocate the file, then `read` from the new path
- `stat` — verify old path no longer exists and new path has correct metadata
- `list_dir` — verify directory contents before and after move

---

## `fixtures/duplicated-functions.py` — Similar Function Bodies

**Purpose:** Tests `patch` when multiple functions have identical docstrings and bodies but different names.

**Edge cases covered:**
- `process`, `process_item`, `process_record` all have identical bodies
- `validate`, `validate_input`, `validate_record` all have identical bodies
- `transform`, `transform_value`, `transform_record` all have identical bodies
- `serialize`, `serialize_item`, `serialize_record` all have identical bodies

**Best tools to test:**
- `patch` — replace a docstring or body and verify only the intended function changes
- `grep` — search for `"Process data."` and find multiple matches
- `batch_edit` — update multiple similar functions at once

---

## `nested/a/b/c/d/e/deep-file.txt` — Deep Nesting

**Purpose:** Tests `list_dir` and `read` on deeply nested paths.

**Edge cases covered:**
- 5 levels of directory nesting
- Long relative path

**Best tools to test:**
- `list_dir` — list contents at each level of the tree
- `read` — read the file at the deepest level
- `stat` — get metadata for the deeply nested file
- `move` — move the file to a shallower path

---

## `logs/app.log` — Log File

**Purpose:** Tests `read`, `grep`, and `append` on append-only log files.

**Edge cases covered:**
- Timestamped lines
- Repeated log levels (`INFO`, `WARN`)
- Realistic log format

**Best tools to test:**
- `grep` — search for `WARN` or specific timestamps
- `read` — verify log format is preserved
- `append` — add new log entries

---

## `logs/error.log` — Error Log

**Purpose:** Tests `read` and `grep` on small log files.

**Edge cases covered:**
- Small file with error-level content
- Distinct from `app.log` for move/diff testing

**Best tools to test:**
- `read` — verify error messages
- `grep` — search for `ERROR`
- `diff` — compare `app.log` and `error.log` (they are different files)

---

## `generated/generated-code.ts` — Generated Code Regions

**Purpose:** Tests `replace_between_markers` on realistic generated code.

**Edge cases covered:**
- Two `BEGIN GENERATED SECTION` / `END GENERATED SECTION` pairs
- TypeScript code inside markers
- Export statements and object literals

**Best tools to test:**
- `replace_between_markers` — regenerate schema or routes
- `read` — verify generated code structure
- `patch` — modify a specific generated function
