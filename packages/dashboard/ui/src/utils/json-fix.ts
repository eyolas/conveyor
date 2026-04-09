/**
 * Attempt to fix common JSON errors:
 * - Unquoted keys: { to: "value" } → { "to": "value" }
 * - Single quotes: { 'key': 'value' } → { "key": "value" }
 * - Trailing commas: { "a": 1, } → { "a": 1 }
 * - Missing commas between properties on separate lines
 *
 * Returns the fixed string, or null if unfixable.
 */
export function tryFixJson(input: string): string | null {
  let fixed = input;

  // Replace single-quoted strings with double-quoted
  fixed = fixed.replace(
    /(?<=[\s,{[:])'((?:[^'\\]|\\.)*)'/g,
    '"$1"',
  );

  // Quote unquoted keys: { key: → { "key":
  fixed = fixed.replace(
    /(?<=[\s,{])([a-zA-Z_$][\w$-]*)(?=\s*:)/g,
    '"$1"',
  );

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // Add missing commas between values on separate lines
  // Matches: "value"\n"key" or "value"\n} patterns where comma is missing
  // e.g. "eve@example.com"\n  subject → "eve@example.com",\n  subject
  fixed = fixed.replace(
    /(["'\d\w}\])])\s*\n(\s*["'{[\w])/g,
    '$1,\n$2',
  );

  // Try parsing the fixed version
  try {
    const parsed = JSON.parse(fixed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Second pass: try a more aggressive approach
    // Re-run key quoting after comma insertion (order matters)
    let retry = fixed;
    retry = retry.replace(
      /(?<=[\s,{])([a-zA-Z_$][\w$-]*)(?=\s*:)/g,
      '"$1"',
    );
    // Remove double-double quotes from double processing
    retry = retry.replace(/""+/g, '"');

    try {
      const parsed = JSON.parse(retry);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  }
}
