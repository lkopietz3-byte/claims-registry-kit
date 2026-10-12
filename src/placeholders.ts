// Placeholder evidence references. Internal except for `DEFAULT_PLACEHOLDER_REFS`,
// which index.ts re-exports.
//
// A reference such as `TODO` or `-` is a person saying "there is no evidence
// yet" in the one field that is supposed to hold it. That is positive evidence
// that the evidence is missing, so the claim is `'unverified'`, not `'current'`.
// The match is exact: only a string that IS a placeholder (after trimming,
// collapsing inner whitespace, dropping invisible characters and ignoring
// case) counts. A real reference that merely contains the word, such as
// `https://example.com/todo-list` or `none-such-ref-123`, is untouched.

/**
 * The placeholders treated as "no evidence" unless `options.placeholderRefs`
 * says otherwise: `TODO`, `TBD`, `N/A`, `none`, `-` and `see above`. Matched
 * exactly, ignoring case, surrounding whitespace and invisible characters.
 * Spread it to extend the list:
 * `{ placeholderRefs: [...DEFAULT_PLACEHOLDER_REFS, 'wip'] }`.
 */
export const DEFAULT_PLACEHOLDER_REFS: readonly string[] = Object.freeze([
  'TODO',
  'TBD',
  'N/A',
  'none',
  '-',
  'see above',
]);

const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;
const WHITESPACE_RUN = /\p{White_Space}+/gu;

/**
 * The comparison form of a string: invisible characters dropped, each run of
 * whitespace collapsed to one space, trimmed, NFKC-normalized (so full-width `ＴＯＤＯ` matches) and lowercased.
 * Control characters that are also whitespace (tab, newline) count as
 * whitespace first, so `'see\nabove'` still reads as `'see above'`.
 */
export function placeholderKey(text: string): string {
  return text
    .replace(WHITESPACE_RUN, ' ')
    .replace(INVISIBLE, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
}

/** The resolved placeholder set, or `null` when placeholder matching is switched off. */
export type PlaceholderSet = ReadonlySet<string> | null;

let defaultSet: ReadonlySet<string> | undefined;

function defaults(): ReadonlySet<string> {
  defaultSet ??= new Set(DEFAULT_PLACEHOLDER_REFS.map(placeholderKey));
  return defaultSet;
}

const PREFIX = 'claims-registry-kit: ';

function isObjectLike(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  try {
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === null || Object.getPrototypeOf(proto) === null;
  } catch {
    return false; // a revoked proxy throws here
  }
}

/**
 * Read `options` once and resolve the placeholder set to use. Omitted
 * options, or an omitted `placeholderRefs`, mean the defaults; `false` or an
 * empty list means none (matching off); a list replaces the defaults.
 *
 * @throws {TypeError} if `options` is not a plain object, or `placeholderRefs`
 * is not `false` or an array of strings.
 */
export function readPlaceholders(options: unknown): PlaceholderSet {
  if (options === undefined) return defaults();
  if (!isObjectLike(options)) {
    throw new TypeError(`${PREFIX}options must be an object (received ${describeKind(options)})`);
  }
  const refs: unknown = options.placeholderRefs;
  if (refs === undefined) return defaults();
  if (refs === false) return null;
  if (!Array.isArray(refs)) {
    throw new TypeError(
      `${PREFIX}options.placeholderRefs must be an array of strings or false (received ${describeKind(refs)})`,
    );
  }
  const list: unknown[] = refs;
  const length: unknown = list.length;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError(`${PREFIX}options.placeholderRefs has an invalid length`);
  }
  const keys = new Set<string>();
  for (let i = 0; i < length; i += 1) {
    const entry = list[i];
    if (typeof entry !== 'string') {
      throw new TypeError(
        `${PREFIX}options.placeholderRefs[${String(i)}] must be a string (received ${describeKind(entry)})`,
      );
    }
    const key = placeholderKey(entry);
    if (key !== '') keys.add(key);
  }
  return keys.size === 0 ? null : keys;
}

function describeKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return typeof value;
}
