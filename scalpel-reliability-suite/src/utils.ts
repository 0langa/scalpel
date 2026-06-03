/**
 * Utility Functions
 * Scalpel Reliability Test Suite - Ambiguity Testing File
 *
 * This file contains intentionally duplicated function names
 * with slight variations to test grep and patch ambiguity handling.
 */

// ---------------------------------------------------------------------------
// parseConfig variants
// ---------------------------------------------------------------------------

export function parseConfig(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = input.split("\n");
  for (const line of lines) {
    const [key, value] = line.split("=");
    if (key && value) {
      result[key.trim()] = value.trim();
    }
  }
  return result;
}

export function parseConfigJSON(input: string): Record<string, unknown> {
  return JSON.parse(input);
}

export function parseConfigYAML(input: string): Record<string, unknown> {
  // TODO: implement YAML parsing
  return {};
}

// ---------------------------------------------------------------------------
// formatOutput variants
// ---------------------------------------------------------------------------

export function formatOutput(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}

export function formatOutputCSV(data: Record<string, unknown>[]): string {
  const keys = Object.keys(data[0] || {});
  const header = keys.join(",");
  const rows = data.map((row) => keys.map((k) => row[k]).join(","));
  return [header, ...rows].join("\n");
}

export function formatOutputXML(data: Record<string, unknown>): string {
  // TODO: implement XML formatting
  return `<root></root>`;
}

// ---------------------------------------------------------------------------
// Repeated exact string for grep testing
// ---------------------------------------------------------------------------

export const STATUS_OK = "status: ok";
export const STATUS_OK_V2 = "status: ok";
export const STATUS_OK_LEGACY = "status: ok";

// ---------------------------------------------------------------------------
// Duplicated exact function body (different signatures)
// ---------------------------------------------------------------------------

export function handleRequest(req: { id: string }): string {
  return `handled ${req.id}`;
}

export function handleRequestLegacy(req: { id: string; version: number }): string {
  return `handled ${req.id}`;
}

// ---------------------------------------------------------------------------
// TODO/FIXME repetition
// ---------------------------------------------------------------------------

// FIXME: resolve race condition in async handler
// FIXME: resolve race condition in async handler
// FIXME: resolve race condition in async handler

// TODO: add caching layer
// TODO: add caching layer
// TODO: add caching layer

// ---------------------------------------------------------------------------
// Similar but not identical function names
// ---------------------------------------------------------------------------

export function getUser(id: string) {
  return { id, name: "User" };
}

export function getUserById(id: string) {
  return { id, name: "User" };
}

export function getUserProfile(id: string) {
  return { id, name: "User", profile: {} };
}

export function getUserSettings(id: string) {
  return { id, name: "User", settings: {} };
}

export function getUserPreferences(id: string) {
  return { id, name: "User", preferences: {} };
}
