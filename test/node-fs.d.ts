// The suite deliberately avoids a @types/node dependency; this is the one
// Node module the README-recipe check needs (to read README.md).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
