// Text helpers shared by the checks, the validators and the registry.
// Internal: not exported from index.ts.

// Blank means "shows nothing": only whitespace, Default_Ignorable_Code_Point
// characters, and control characters. Default_Ignorable_Code_Point is the
// Unicode property for characters a renderer is told to draw as nothing:
// zero-width spaces and joiners, the soft hyphen, the word joiner, every bidi
// control (U+200E/F, U+202A-E, U+2066-9, U+061C), variation selectors, Hangul
// fillers and the tag characters. A hand-written range list missed U+061C and
// the four isolate controls. Visible text in any script, emoji, and visible
// text wrapped in bidi controls all still count as present.
const BLANK = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]*$/u;

/**
 * Whether `text` shows nothing to a reader: empty, or made only of
 * whitespace, invisible formatting characters (zero-width characters, bidi
 * controls, the soft hyphen, variation selectors, ...) and control
 * characters. `String.prototype.trim` alone misses the invisible ones.
 */
export function isVisiblyBlank(text: string): boolean {
  return BLANK.test(text);
}

// Everything that could end a line, move the cursor, send a terminal escape,
// or reorder the text around it when a caller-supplied string is printed:
//   \p{Cc}            C0 controls (ESC, CR, LF, NUL, ...), DEL, and C1 controls
//   U+2028, U+2029    line and paragraph separators (line breaks in many viewers)
//   U+061C            Arabic letter mark
//   U+200E, U+200F    left-to-right and right-to-left marks
//   U+202A-U+202E     embeddings and overrides
//   U+2066-U+2069     isolates
const UNSAFE_FOR_DISPLAY = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Make a caller-supplied string safe to print inside a line of report text.
 * Every control character (including CR, LF and ESC), line or paragraph
 * separator and bidi formatting character is replaced by a visible
 * `\uXXXX` escape (four lowercase hex digits, for example `\u001b`). Visible
 * text in every script, emoji and backslashes are left alone. The escape is
 * for display only and is not reversible: a string that literally contains
 * the six characters `\u001b` reads the same as one containing ESC.
 */
export function escapeForDisplay(text: string): string {
  return text.replace(
    UNSAFE_FOR_DISPLAY,
    (ch) => `\\u${(ch.codePointAt(0) as number).toString(16).padStart(4, '0')}`,
  );
}

/**
 * Turn any value into a display string that is escaped and can never throw.
 * Strings are escaped as-is; numbers, booleans, `null` and `undefined` print
 * as themselves; a bigint prints as `1n`; a symbol, function or object is
 * named by kind. It never calls the value's own `toString`, `toJSON` or
 * getters, so a hostile value cannot break the report that prints it.
 */
export function displayValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return escapeForDisplay(value);
    case 'bigint':
      return `${String(value)}n`;
    case 'symbol':
      return 'a symbol';
    case 'function':
      return 'a function';
    case 'object':
      return value === null ? 'null' : 'an object';
    default:
      return String(value);
  }
}
