/**
 * Attempt to fix common JSON errors:
 * - Unquoted keys: { to: "value" } → { "to": "value" }
 * - Single quotes: { 'key': 'value' } → { "key": "value" }
 * - Trailing commas: { "a": 1, } → { "a": 1 }
 * - Missing commas between properties on separate lines
 *
 * Returns the fixed string, or null if unfixable.
 */

const MAX_INPUT_LENGTH = 100_000;

export function tryFixJson(input: string): string | null {
  // Reject very large inputs to prevent ReDoS
  if (input.length > MAX_INPUT_LENGTH) return null;

  let fixed = input;

  // Replace single-quoted strings with double-quoted (bounded inner match)
  fixed = fixed.replace(
    /(?<=[\s,{[:])'([^']{0,10000})'/g,
    '"$1"',
  );

  // Quote unquoted keys: { key: → { "key":
  fixed = fixed.replace(
    /(?<=[\s,{])([a-zA-Z_$][\w$-]{0,100})(?=\s{0,20}:)/g,
    '"$1"',
  );

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,(\s{0,20}[}\]])/g, '$1');

  // Add missing commas between values on separate lines
  fixed = fixed.replace(
    /(["'\d\w}\])])\s{0,20}\n(\s{0,100}["'{[\w])/g,
    '$1,\n$2',
  );

  // Try parsing
  try {
    const parsed = JSON.parse(fixed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Second pass: re-run key quoting after comma insertion
    let retry = fixed;
    retry = retry.replace(
      /(?<=[\s,{])([a-zA-Z_$][\w$-]{0,100})(?=\s{0,20}:)/g,
      '"$1"',
    );
    retry = retry.replace(/""+/g, '"');

    try {
      const parsed = JSON.parse(retry);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  }
}
