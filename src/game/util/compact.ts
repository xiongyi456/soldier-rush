/** In-place compact: drop dead items without allocating a new array. */
export function compactInPlace<T>(items: T[], keep: (item: T) => boolean, onDrop?: (item: T) => void): void {
  let write = 0;
  for (let read = 0; read < items.length; read += 1) {
    const item = items[read];
    if (keep(item)) {
      if (write !== read) items[write] = item;
      write += 1;
    } else {
      onDrop?.(item);
    }
  }
  items.length = write;
}
