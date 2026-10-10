import { displayValue, escapeForDisplay, isVisiblyBlank, normalizeForMatch } from './text.js';
import { evaluate } from './checks.js';
import { readPlaceholders } from './placeholders.js';
import { assertMaxAgeDays, readNow, snapshotClaim } from './validate.js';
import type { ClaimsRegistry } from './registry.js';
import type { Claim, ClaimStatus, EvidenceOptions } from './types.js';

const PREFIX = 'claims-registry-kit: ';

/** What `checkAppearsIn` decided for one claim id. */
export type AppearsInVerdict = 'present' | 'stale' | 'missing' | 'unknown-id';

/** The verdict for one requested claim id. */
export interface AppearsInResult {
  id: string;
  verdict: AppearsInVerdict;
  /**
   * The claim's status under the staleness rules (`'current'`, `'stale'` or
   * `'unverified'`). Absent for `'unknown-id'`, and for `'missing'` when the
   * claim text could not be matched at all.
   */
  claimStatus?: ClaimStatus;
}

/** All verdicts, in the order the ids were first seen, plus `ok`. */
export interface AppearsInReport {
  /** True only when the list is non-empty and every claim is `'present'`. */
  ok: boolean;
  results: AppearsInResult[];
}

/** Options for `checkAppearsIn` and `assertAppearsIn`. */
export interface AppearsInOptions extends EvidenceOptions {
  /** The staleness policy, as in `evaluateClaim`. Required: a page check must not guess one. */
  maxAgeDays: number;
  /** The clock. Defaults to `new Date()`. */
  now?: Date;
  /** Match without regard to case. Defaults to `false` (case-sensitive). */
  ignoreCase?: boolean;
}

/** All the registry is asked to do: look up a claim by exact id. */
export type ClaimLookup<EvidenceRef = string> = Pick<ClaimsRegistry<EvidenceRef>, 'getClaim'>;

// ---------------------------------------------------------------------------
// Word boundaries

const WORD_CHAR = /^[\p{L}\p{N}\p{M}_]$/u;
const DIGIT = /^\p{N}$/u;

function isWord(codePoint: number): boolean {
  return WORD_CHAR.test(String.fromCodePoint(codePoint));
}

function isDigit(codePoint: number): boolean {
  return DIGIT.test(String.fromCodePoint(codePoint));
}

function isHigh(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLow(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** The code point that ends just before `index` (a whole pair if it is one), or -1. */
function codePointBefore(text: string, index: number): number {
  if (index <= 0) return -1;
  const unit = text.charCodeAt(index - 1);
  if (isLow(unit) && index >= 2 && isHigh(text.charCodeAt(index - 2))) {
    return text.codePointAt(index - 2) as number;
  }
  return unit;
}

function codePointAfter(text: string, index: number): number {
  return index >= text.length ? -1 : (text.codePointAt(index) as number);
}

interface NeedleEdges {
  firstWord: boolean;
  firstDigit: boolean;
  lastWord: boolean;
  lastDigit: boolean;
}

function edgesOf(needle: string): NeedleEdges {
  const first = needle.codePointAt(0) as number;
  let lastIndex = needle.length - 1;
  if (lastIndex > 0 && isLow(needle.charCodeAt(lastIndex)) && isHigh(needle.charCodeAt(lastIndex - 1))) {
    lastIndex -= 1;
  }
  const last = needle.codePointAt(lastIndex) as number;
  return {
    firstWord: isWord(first),
    firstDigit: isDigit(first),
    lastWord: isWord(last),
    lastDigit: isDigit(last),
  };
}

function isNumberSeparator(codePoint: number): boolean {
  return codePoint === 0x2e || codePoint === 0x2c; // . ,
}

/**
 * Whether a match at [start, end) stands on its own: it does not start or end
 * inside a surrogate pair, and it does not start or end in the middle of a
 * word or a number. An edge that is itself punctuation or a symbol needs no
 * check on that side. A digit edge also counts `.` or `,` next to another
 * digit as part of the number (`20` is not in `20.5` or `1.20`).
 */
function standsAlone(text: string, start: number, end: number, edges: NeedleEdges): boolean {
  if (start > 0 && isLow(text.charCodeAt(start)) && isHigh(text.charCodeAt(start - 1))) return false;
  if (end < text.length && isLow(text.charCodeAt(end)) && isHigh(text.charCodeAt(end - 1))) return false;
  if (edges.firstWord) {
    const before = codePointBefore(text, start);
    if (before !== -1 && isWord(before)) return false;
    if (
      edges.firstDigit &&
      before !== -1 &&
      isNumberSeparator(before) &&
      isDigit(codePointBefore(text, start - 1))
    ) {
      return false;
    }
  }
  if (edges.lastWord) {
    const after = codePointAfter(text, end);
    if (after !== -1 && isWord(after)) return false;
    if (
      edges.lastDigit &&
      after !== -1 &&
      isNumberSeparator(after) &&
      isDigit(codePointAfter(text, end + 1))
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Multi-pattern search (Aho-Corasick). One pass over the text however many
// claims are asked about; the work is linear in the text plus the total length
// of the claim texts. A per-claim substring search would cost
// (claims x text length) and can go quadratic on repetitive text.

function findAll(text: string, needles: readonly string[]): boolean[] {
  const found: boolean[] = needles.map(() => false);
  const edges = new Map<number, number>(); // node * 65536 + unit -> child
  const parent: number[] = [0];
  const unitOf: number[] = [0];
  const depth: number[] = [0];
  const terminal: number[] = [-1]; // node -> needle index
  const lengths: number[] = [];
  const edgeInfo: NeedleEdges[] = [];

  for (let n = 0; n < needles.length; n += 1) {
    const needle = needles[n];
    lengths.push(needle.length);
    edgeInfo.push(edgesOf(needle));
    let node = 0;
    for (let i = 0; i < needle.length; i += 1) {
      const unit = needle.charCodeAt(i);
      const key = node * 65536 + unit;
      let next = edges.get(key);
      if (next === undefined) {
        next = parent.length;
        edges.set(key, next);
        parent.push(node);
        unitOf.push(unit);
        depth.push(depth[node] + 1);
        terminal.push(-1);
      }
      node = next;
    }
    terminal[node] = n;
  }

  // Failure links, shallowest nodes first.
  const nodeCount = parent.length;
  const fail: number[] = new Array<number>(nodeCount).fill(0);
  const byDepth: number[][] = [];
  for (let v = 1; v < nodeCount; v += 1) {
    const d = depth[v];
    (byDepth[d] ??= []).push(v);
  }
  for (const level of byDepth) {
    if (level === undefined) continue;
    for (const v of level) {
      const unit = unitOf[v];
      const p = parent[v];
      let f = 0;
      if (p !== 0) {
        f = fail[p];
        while (f !== 0 && !edges.has(f * 65536 + unit)) f = fail[f];
        f = edges.get(f * 65536 + unit) ?? 0;
      }
      fail[v] = f;
    }
  }

  // Two chains of "the next shorter claim text that ends here":
  // `linkAll` over every claim, `linkSafe` over claims whose last character is
  // not a word character (those need no check on what follows). Each chain
  // skips claims already found, with path compression, so a claim that has
  // been seen costs nothing after that.
  const linkAll: number[] = new Array<number>(nodeCount).fill(-1);
  const linkSafe: number[] = new Array<number>(nodeCount).fill(-1);
  const isSafe = (node: number): boolean => {
    const n = terminal[node];
    return n >= 0 && !(edgeInfo[n]).lastWord;
  };
  for (const level of byDepth) {
    if (level === undefined) continue;
    for (const v of level) {
      const f = fail[v];
      linkAll[v] = (terminal[f]) >= 0 ? f : (linkAll[f]);
      linkSafe[v] = isSafe(f) ? f : (linkSafe[f]);
    }
  }
  const live = (link: number[], head: number): number => {
    let r = head;
    while (r >= 0 && found[terminal[r]] === true) r = link[r];
    // Compress: every node walked now points straight at the first live one.
    let u = head;
    while (u >= 0 && u !== r) {
      const next = link[u];
      link[u] = r;
      u = next;
    }
    return r;
  };

  let remaining = needles.length;
  let state = 0;
  for (let i = 0; i < text.length && remaining > 0; i += 1) {
    const unit = text.charCodeAt(i);
    while (state !== 0 && !edges.has(state * 65536 + unit)) state = fail[state];
    state = edges.get(state * 65536 + unit) ?? 0;
    const end = i + 1;
    // What follows decides, once for this position, which chain can still
    // match: inside a run of word characters only claims that end in a
    // non-word character can.
    const afterWord = end < text.length && isWord(text.codePointAt(end) as number);
    const link = afterWord ? linkSafe : linkAll;
    const own = afterWord ? isSafe(state) : (terminal[state]) >= 0;
    let v = own ? state : (link[state]);
    v = live(link, v);
    while (v >= 0) {
      const n = terminal[v];
      if (standsAlone(text, end - (lengths[n]), end, edgeInfo[n])) {
        found[n] = true;
        remaining -= 1;
      }
      v = live(link, link[v]);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Public API

function readLookup<EvidenceRef>(registry: unknown): (id: string) => Claim<EvidenceRef> | undefined {
  const getClaim = (registry as { getClaim?: unknown } | null | undefined)?.getClaim;
  if (typeof getClaim !== 'function') {
    throw new TypeError(`${PREFIX}registry must be an object with a getClaim(id) function`);
  }
  return (id) => {
    const found = (getClaim as (id: string) => unknown).call(registry, id);
    return found === undefined ? undefined : snapshotClaim<EvidenceRef>(found, `registry claim "${escapeForDisplay(id)}"`);
  };
}

function readIds(claimIds: unknown): string[] {
  if (!Array.isArray(claimIds)) {
    throw new TypeError(`${PREFIX}claimIds must be an array of strings (received ${displayValue(claimIds)})`);
  }
  const length: unknown = (claimIds as unknown[]).length;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError(`${PREFIX}claimIds has an invalid length (received ${displayValue(length)})`);
  }
  if (length === 0) {
    throw new RangeError(
      `${PREFIX}claimIds must name at least one claim (an empty list would pass without checking anything)`,
    );
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const id: unknown = (claimIds as unknown[])[i];
    if (typeof id !== 'string') {
      throw new TypeError(`${PREFIX}claimIds[${String(i)}] must be a string (received ${displayValue(id)})`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Does the published `text` contain the current wording of these registered
 * claims? Returns one verdict per distinct id, in first-seen order:
 *
 * - `'present'`: the claim's text is in `text` and the claim is `'current'`.
 * - `'stale'`: the text is in `text` but the claim is not `'current'` under
 *   `evaluateClaim` (`maxAgeDays` and `now`; its `claimStatus` says whether it
 *   is `'stale'` or `'unverified'`). Showing it is the problem.
 * - `'missing'`: the text is not in `text`, or the claim's `text` is not a
 *   string or shows nothing. Missing wins over stale: absent wording is not
 *   being shown.
 * - `'unknown-id'`: no claim is registered under exactly that id (a look-alike
 *   spelling does not count).
 *
 * `ok` is true only when every verdict is `'present'`.
 *
 * Matching: both sides go through NFKC, whitespace runs become one space,
 * invisible characters are dropped, curly quotes and dash variants fold to
 * `'`, `"` and `-`. Case matters unless `ignoreCase` is set. A match must stand
 * on word boundaries: `uptime` is not found in `uptimes`, and `20` is not found
 * in `120`, `20.5` or `1.20`. One pass over `text` for all claims, so cost is
 * linear in the text plus the claim texts.
 *
 * The registry is only asked for `getClaim(id)`; each entry is copied once.
 * An error thrown by the registry or an entry propagates.
 *
 * @throws {TypeError} for a registry without `getClaim`, a non-string `text`,
 * a non-array or sparse `claimIds`, a non-string id, a registry entry that is
 * not a plain object, a missing or non-number `maxAgeDays`, a `now` that is
 * not a `Date`, or a non-boolean `ignoreCase`.
 * @throws {RangeError} for an empty `claimIds` (it would pass having checked
 * nothing), a bad `maxAgeDays`, or an Invalid Date `now`.
 */
export function checkAppearsIn<EvidenceRef = string>(
  registry: ClaimLookup<EvidenceRef>,
  text: string,
  claimIds: readonly string[],
  options: AppearsInOptions,
): AppearsInReport {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(`${PREFIX}options must be an object with maxAgeDays`);
  }
  const opts: AppearsInOptions = { ...options };
  assertMaxAgeDays(opts.maxAgeDays);
  const nowMs = readNow(opts.now === undefined ? new Date() : opts.now);
  if (opts.ignoreCase !== undefined && typeof opts.ignoreCase !== 'boolean') {
    throw new TypeError(`${PREFIX}options.ignoreCase must be a boolean`);
  }
  const ignoreCase = opts.ignoreCase === true;
  // Resolved once: every claim is judged against this one snapshot.
  const placeholders = readPlaceholders(opts);
  if (typeof text !== 'string') {
    throw new TypeError(`${PREFIX}text must be a string (received ${displayValue(text)})`);
  }
  const lookup = readLookup<EvidenceRef>(registry);
  const ids = readIds(claimIds);

  // Resolve every id once, and collect the distinct normalized wordings.
  interface Entry {
    id: string;
    claimStatus?: ClaimStatus;
    needle?: string;
    unknown: boolean;
  }
  const entries: Entry[] = [];
  const needleIndex = new Map<string, number>();
  const needles: string[] = [];
  for (const id of ids) {
    const claim = lookup(id);
    if (claim === undefined) {
      entries.push({ id, unknown: true });
      continue;
    }
    const claimText: unknown = claim.text;
    const evaluated = evaluate(claim, opts.maxAgeDays, nowMs, placeholders);
    const entry: Entry = { id, unknown: false, claimStatus: evaluated.status };
    if (typeof claimText === 'string') {
      const needle = normalizeForMatch(claimText, ignoreCase);
      if (!isVisiblyBlank(claimText) && needle.length > 0) {
        entry.needle = needle;
        if (!needleIndex.has(needle)) {
          needleIndex.set(needle, needles.length);
          needles.push(needle);
        }
      }
    }
    entries.push(entry);
  }

  const found = needles.length > 0 ? findAll(normalizeForMatch(text, ignoreCase), needles) : [];

  const results: AppearsInResult[] = entries.map((entry) => {
    if (entry.unknown) return { id: entry.id, verdict: 'unknown-id' };
    const shown = entry.needle !== undefined && found[needleIndex.get(entry.needle) as number] === true;
    const claimStatus = entry.claimStatus as ClaimStatus;
    if (!shown) return { id: entry.id, verdict: 'missing', claimStatus };
    return { id: entry.id, verdict: claimStatus === 'current' ? 'present' : 'stale', claimStatus };
  });
  return { ok: results.every((r) => r.verdict === 'present'), results };
}

const MAX_LISTED = 20;

/**
 * `checkAppearsIn`, but throws an `Error` naming every claim that is not
 * `'present'` (the first 20, then a count), for tests and CI. Returns the
 * report when everything is present. Ids are printed with control and bidi
 * characters escaped. Same arguments and argument errors as `checkAppearsIn`.
 */
export function assertAppearsIn<EvidenceRef = string>(
  registry: ClaimLookup<EvidenceRef>,
  text: string,
  claimIds: readonly string[],
  options: AppearsInOptions,
): AppearsInReport {
  const report = checkAppearsIn(registry, text, claimIds, options);
  if (report.ok) return report;
  const failing = report.results.filter((r) => r.verdict !== 'present');
  const listed = failing
    .slice(0, MAX_LISTED)
    .map((r) => `"${escapeForDisplay(r.id)}" (${r.verdict})`)
    .join(', ');
  const more = failing.length > MAX_LISTED ? `, and ${String(failing.length - MAX_LISTED)} more` : '';
  throw new Error(
    `${PREFIX}the published text does not show the current wording of ${String(failing.length)} of ${String(report.results.length)} claim(s): ${listed}${more}`,
  );
}
