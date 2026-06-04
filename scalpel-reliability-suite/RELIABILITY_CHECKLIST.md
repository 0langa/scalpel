# Reliability Checklist

Use this checklist to manually validate all 14 MCP file-editing tools against the `scalpel-reliability-suite` project.

---

## Tool 1: `read`

### Basic Behavior
- [ ] Read `src/helpers.py` — verify exact 2-line content is returned
- [ ] Read `src/empty.ts` — verify empty string is returned (size = 0)
- [ ] Read `fixtures/tiny.txt` — verify single line `"tiny"` is returned
- [ ] Read `src/app.ts` — verify full file is returned without truncation (~300 lines)
- [ ] Read `src/types.d.ts` — verify very long lines are not wrapped or truncated
- [ ] Read `fixtures/large-content.md` — verify full ~12 KB file is returned
- [ ] Read `fixtures/mixed-newlines.txt` — verify mixed `\r\n` and `\n` are preserved

### Line Ranges
- [ ] Read lines 1-10 of `fixtures/numbered-lines.txt` — verify lines 001-010
- [ ] Read lines 41-50 of `fixtures/numbered-lines.txt` — verify lines 041-050
- [ ] Read lines 100-110 of `src/app.ts` — verify correct line slice
- [ ] Read last 5 lines of `docs/CHANGELOG.md` — verify tail reading works

### Deep Paths
- [ ] Read `nested/a/b/c/d/e/deep-file.txt` — verify content is accessible

---

## Tool 2: `stat`

### Basic Metadata
- [ ] Stat `src/empty.ts` — verify size is 0, type is file
- [ ] Stat `fixtures/tiny.txt` — verify size is 5 bytes
- [ ] Stat `src/app.ts` — verify size is ~9 KB, type is file
- [ ] Stat `src/config.py` — verify size is ~10 KB

### Directories
- [ ] Stat `src/` — verify type is directory
- [ ] Stat `nested/a/b/c/d/e/` — verify deep directory is recognized

### Missing Files
- [ ] Stat `does-not-exist.txt` — verify appropriate error is returned

---

## Tool 3: `list_dir`

### Basic Listing
- [ ] List `src/` — verify 7 items: `app.ts`, `config.py`, `data.json`, `empty.ts`, `helpers.py`, `types.d.ts`, `utils.ts`
- [ ] List `docs/` — verify 4 items: `API.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `README.md`
- [ ] List `config/` — verify 4 items: `deployment.yaml`, `manifest.json`, `pyproject.toml`, `settings.ini`
- [ ] List `fixtures/` — verify 9 items

### Deep Nesting
- [ ] List `nested/` — verify `a/` is present
- [ ] List `nested/a/b/c/d/e/` — verify `deep-file.txt` is present

### Empty Directory
- [ ] List `generated/` — verify `generated-code.ts` is present

---

## Tool 4: `grep`

### Basic Search
- [ ] Grep `src/app.ts` for `"formatDate"` — verify all 3 variants found
- [ ] Grep `src/utils.ts` for `"status: ok"` — verify 3 matches
- [ ] Grep `docs/CONTRIBUTING.md` for `"TODO"` — verify 6 matches (3 unique lines + 3 duplicates)
- [ ] Grep `fixtures/repeated-strings.txt` for `"alpha"` — verify 33+ matches

### Current Limits
- [ ] Grep `src/config.py` for `"validate_config"` — verify matching lines are returned without before/after context

### Pattern Matching
- [ ] Grep `src/app.ts` for `"^export"` — verify regex anchor works
- [ ] Grep `src/utils.ts` for `"getUser"` — verify partial match finds all 5 variants

### Edge Cases
- [ ] Grep `src/empty.ts` for `"anything"` — verify no matches without error
- [ ] Grep `fixtures/long-lines.txt` for `"AAAAAAAAAA"` — verify match on very long line

---

## Tool 5: `create`

### New Files
- [ ] Create `new-file.txt` in root — verify content is exact
- [ ] Create `src/new-module.ts` — verify file appears in `src/`
- [ ] Create `nested/a/b/c/d/e/another-deep.txt` — verify deep creation works

### Overwrite Behavior
- [ ] Create `fixtures/tiny.txt` with new content — verify behavior (overwrite or error)

### Empty Content
- [ ] Create `empty-new.txt` with empty content — verify 0-byte file

---

## Tool 6: `patch`

### Exact Match
- [ ] Patch `fixtures/numbered-lines.txt` — replace `"005 | Line number five"` with `"005 | Line number five MODIFIED"`
- [ ] Patch `src/helpers.py` — replace `"def hello():"` with `"def hello_world():"`

### Ambiguous Matches
- [ ] Patch `src/utils.ts` — replace `"status: ok"` and observe behavior (first only? all? error?)
- [ ] Patch `fixtures/repeated-strings.txt` — replace one `"alpha"` and verify only one line changes

### Large File Patches
- [ ] Patch `src/app.ts` — replace one `formatDate` function body
- [ ] Patch `src/config.py` — replace `validate_config` docstring

### JSON Patches
- [ ] Patch `src/data.json` — replace `"version": "1.0.0"` with `"version": "1.1.0"`

### Edge Cases
- [ ] Patch `fixtures/tiny.txt` — replace `"tiny"` with `"small"`
- [ ] Patch `src/empty.ts` — attempt to replace `""` with `"content"`

---

## Tool 7: `batch_edit`

### Atomic Multiple Edits
- [ ] Batch edit `fixtures/numbered-lines.txt`:
  1. Replace `"001 | ..."` with `"001 | MODIFIED"`
  2. Replace `"002 | ..."` with `"002 | MODIFIED"`
  3. Replace `"003 | ..."` with `"003 | MODIFIED"`
- [ ] Verify all three changes applied or all failed (atomicity)

### Current Scope
- [ ] Verify `batch_edit` is single-file only; use separate calls for multi-file edits

### Overlapping Matches
- [ ] Batch edit `fixtures/repeated-strings.txt` — replace `"alpha"` and `"beta"` in one operation

---

## Tool 8: `insert`

### Line-Based Insert
- [ ] Insert at line 1 of `fixtures/numbered-lines.txt` — verify new line becomes 001, old 001 becomes 002
- [ ] Insert at line 50 of `fixtures/numbered-lines.txt` — verify insertion at end
- [ ] Insert at line 25 of `fixtures/numbered-lines.txt` — verify middle insertion

### Marker-Based Insert
- [ ] Insert after `"# BEGIN SECTION"` in `fixtures/ambiguous-markers.txt` — verify duplicate marker error
- [ ] Insert before `"# END SECTION"` in `fixtures/ambiguous-markers.txt` — verify duplicate marker error

### Edge Cases
- [ ] Insert into `src/empty.ts` — verify first line is created
- [ ] Insert at line 1000 of `fixtures/numbered-lines.txt` — verify behavior at out-of-bounds line

---

## Tool 9: `delete_range`

### Line-Based Deletion
- [ ] Delete lines 10-20 in `fixtures/numbered-lines.txt` — verify lines 010-020 removed, 021 follows 009
- [ ] Delete lines 1-5 in `fixtures/numbered-lines.txt` — verify first 5 lines removed
- [ ] Delete lines 46-50 in `fixtures/numbered-lines.txt` — verify last 5 lines removed

### Marker-Based Deletion
- [ ] Delete between `# BEGIN SECTION` and `# END SECTION` in `fixtures/ambiguous-markers.txt` — verify duplicate marker error
- [ ] Delete between `<!-- BEGIN GENERATED SECTION -->` and `<!-- END GENERATED SECTION -->` in `docs/README.md` — verify duplicate marker error if markers are not unique

### Edge Cases
- [ ] Delete lines 1-1 in `fixtures/numbered-lines.txt` — verify single line deletion
- [ ] Delete range in `src/empty.ts` — verify behavior on empty file

---

## Tool 10: `replace_between_markers`

### Unique Markers
- [ ] Replace between `# BEGIN UNIQUE` and `# END UNIQUE` in `fixtures/ambiguous-markers.txt` — verify replacement is exact

### Duplicate Markers
- [ ] Replace between `# BEGIN SECTION` and `# END SECTION` in `fixtures/ambiguous-markers.txt` — verify duplicate marker error
- [ ] Replace between `// BEGIN GENERATED SECTION` and `// END GENERATED SECTION` in `src/app.ts` — verify duplicate marker error if markers are not unique
- [ ] Replace between `<!-- BEGIN GENERATED SECTION -->` and `<!-- END GENERATED SECTION -->` in `docs/README.md` — verify duplicate marker error if markers are not unique

### YAML Markers
- [ ] Replace between `# BEGIN CONFIG BLOCK` and `# END CONFIG BLOCK` in `config/deployment.yaml`

### Python Markers
- [ ] Replace between `# BEGIN GENERATED SECTION` and `# END GENERATED SECTION` in `src/config.py`

---

## Tool 11: `append`

### Basic Append
- [ ] Append `"New line at end"` to `fixtures/tiny.txt` — verify it becomes line 2
- [ ] Append `"\nNew changelog entry"` to `docs/CHANGELOG.md` — verify content is added at end

### Empty File
- [ ] Append `"first"` to `src/empty.ts` — verify file now has 1 line

### Multiple Appends
- [ ] Append `"A"` then `"B"` then `"C"` to `new-append-test.txt` — verify order is A, B, C

---

## Tool 12: `prepend`

### Basic Prepend
- [ ] Prepend `"New line at start\n"` to `fixtures/tiny.txt` — verify it becomes line 1, old content shifts down
- [ ] Prepend `"# New header\n"` to `docs/CHANGELOG.md` — verify header appears before version history

### Empty File
- [ ] Prepend `"first"` to a new empty file — verify file has 1 line

### Multiple Prepends
- [ ] Prepend `"A"` then `"B"` then `"C"` to `new-prepend-test.txt` — verify order is C, B, A (most recent first)

---

## Tool 13: `diff`

### Basic Diff
- [ ] Diff `fixtures/numbered-lines.txt` after patching line 005 — verify unified diff shows single changed line
- [ ] Diff `src/helpers.py` after renaming function — verify function name change

### Large File Diff
- [ ] Diff `src/app.ts` after modifying one function — verify diff is minimal and correct

### Empty File Diff
- [ ] Diff `src/empty.ts` after appending content — verify addition of first line

### Comparison Diff
- [ ] Diff `logs/app.log` against `logs/error.log` — verify diff shows all differences

---

## Tool 14: `move`

### Rename
- [ ] Move `fixtures/move-source.txt` to `fixtures/move-target.txt` — verify content identical at new path
- [ ] Stat old path — verify file no longer exists
- [ ] Stat new path — verify file exists with same size

### Relocate
- [ ] Move `fixtures/move-target.txt` to `src/moved-file.txt` — verify file in new directory
- [ ] List `src/` — verify `moved-file.txt` appears
- [ ] List `fixtures/` — verify `move-target.txt` is gone

### Deep Path Move
- [ ] Move `nested/a/b/c/d/e/deep-file.txt` to `nested/deep-file.txt` — verify shallow relocation

### Overwrite Behavior
- [ ] Move `src/helpers.py` to `src/utils.ts` — observe behavior (overwrite? error?)

---

## Summary

After completing all checks above, record the results:

| Tool                  | Pass | Fail | Notes |
|-----------------------|------|------|-------|
| `read`                | [ ]  | [ ]  |       |
| `stat`                | [ ]  | [ ]  |       |
| `list_dir`            | [ ]  | [ ]  |       |
| `grep`                | [ ]  | [ ]  |       |
| `create`              | [ ]  | [ ]  |       |
| `patch`               | [ ]  | [ ]  |       |
| `batch_edit`          | [ ]  | [ ]  |       |
| `insert`              | [ ]  | [ ]  |       |
| `delete_range`        | [ ]  | [ ]  |       |
| `replace_between_markers` | [ ] | [ ] |       |
| `append`              | [ ]  | [ ]  |       |
| `prepend`             | [ ]  | [ ]  |       |
| `diff`                | [ ]  | [ ]  |       |
| `move`                | [ ]  | [ ]  |       |
