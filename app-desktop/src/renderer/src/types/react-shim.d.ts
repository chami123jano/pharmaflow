// Minimal React type shim to satisfy TS without installing @types/react
// This is intentionally lightweight and only covers what's used in this codebase.
declare module 'react' {
  export type ReactNode = any;
  export type FC<P = {}> = (props: P & { children?: ReactNode }) => any;
  export function useState<S = any>(initial: S | (() => S)): [S, (s: S | ((prev: S) => S)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useRef<T = any>(init?: T): { current: T };
  const React: { createElement: any };
  export default React;
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
