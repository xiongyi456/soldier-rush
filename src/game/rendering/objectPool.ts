export class ObjectPool<T> {
  readonly free: T[] = [];
  readonly active = new Set<T>();

  constructor(
    private readonly create: () => T,
    private readonly reset: (item: T) => void,
    warmCount = 0,
  ) {
    for (let index = 0; index < warmCount; index += 1) this.free.push(this.create());
  }

  acquire(): T {
    const item = this.free.pop() ?? this.create();
    this.active.add(item);
    return item;
  }

  release(item: T): void {
    if (!this.active.delete(item)) return;
    this.reset(item);
    this.free.push(item);
  }

  releaseAll(): void {
    for (const item of [...this.active]) this.release(item);
  }
}
