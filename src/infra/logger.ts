import pino from "pino";

export function createLogger(level: "silent" | "error" | "info" | "debug") {
  return pino({
    level: level === "silent" ? "silent" : level,
    base: null
  });
}
