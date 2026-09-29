// The suite deliberately avoids a @types/node dependency; this is the one
// Node module it needs (to build a value from another realm in tests).
declare module 'node:vm' {
  export function runInNewContext(code: string): unknown;
}
