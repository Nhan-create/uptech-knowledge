export interface RecoveringPromiseCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
}

export function createRecoveringPromiseCache<T>(): RecoveringPromiseCache<T> {
  let entry:
    | { readonly key: string; readonly promise: Promise<T> }
    | undefined;
  return Object.freeze({
    get(key: string, load: () => Promise<T>): Promise<T> {
      if (entry?.key === key) return entry.promise;
      const loading = Promise.resolve().then(load);
      const next: { key: string; promise: Promise<T> } = {
        key,
        promise: loading,
      };
      const recoverable = loading.catch((error: unknown) => {
        if (entry === next) entry = undefined;
        throw error;
      });
      next.promise = recoverable;
      entry = next;
      return recoverable;
    },
  });
}
