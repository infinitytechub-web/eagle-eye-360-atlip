// Structured JSON logs (one line per event) — never log credentials or tokens.
const out = (level, msg, extra = {}) =>
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }) + '\n');
export const log = {
  info: (m, e) => out('info', m, e), warn: (m, e) => out('warn', m, e), error: (m, e) => out('error', m, e),
};
