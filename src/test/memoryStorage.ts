/**
 * Minimal in-memory `Storage` implementation for tests. Avoids pulling in
 * jsdom just to get `sessionStorage`/`localStorage` — the modules under test
 * only ever call getItem/setItem/removeItem.
 */
export class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  get length(): number {
    return this.store.size
  }
}
