// Root-level type declarations for the `midi` package (the npm
// `midi` native binding ships no `.d.ts`, and there is no
// `@types/midi` on npm).
//
// Per-package mirrors of this shim live at
// `packages/<pkg>/src/types/midi.d.ts` — each package's own
// `tsconfig.json` picks the local copy up so `npm run typecheck`
// works per-package. This root copy exists for the OTHER lane:
// when the CI workflow (or anyone) runs `npx tsc --noEmit` at
// the repo root, the root tsconfig's `include` covers
// `scripts/**/*` plus this `types/**/*` directory but does NOT
// include any package's `src/types/*.d.ts`, so the per-package
// shims aren't visible. Without this file, scripts that import
// `midi` directly (`scripts/capture-midi-passive.ts`,
// `scripts/hydrasynth/*.ts`) fail TS7016 in CI even though they
// run fine via `tsx`. Keep the shape in lockstep with the
// per-package copies.

declare module 'midi' {
  type MessageHandler = (deltaTime: number, message: number[]) => void;

  class Input {
    getPortCount(): number;
    getPortName(index: number): string;
    openPort(index: number): void;
    openVirtualPort(name: string): void;
    closePort(): void;
    isPortOpen(): boolean;
    on(event: 'message', handler: MessageHandler): this;
    ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
  }

  class Output {
    getPortCount(): number;
    getPortName(index: number): string;
    openPort(index: number): void;
    openVirtualPort(name: string): void;
    closePort(): void;
    isPortOpen(): boolean;
    sendMessage(message: number[]): void;
  }

  const _default: { Input: typeof Input; Output: typeof Output };
  export default _default;
  export { Input, Output };
}
