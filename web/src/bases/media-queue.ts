// Runs at most `limit` tasks at once; a cancelled task that has not started is dropped.
export function createQueue(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    while (active < limit && waiting.length > 0) waiting.shift()!();
  };
  return function enqueue(task: () => Promise<void>): () => void {
    let started = false;
    let dropped = false;
    const run = () => {
      if (dropped) return;
      started = true;
      active++;
      task()
        .catch(() => {})
        .finally(() => {
          active--;
          next();
        });
    };
    waiting.push(run);
    next();
    return () => {
      dropped = true;
      if (!started) {
        const i = waiting.indexOf(run);
        if (i >= 0) waiting.splice(i, 1);
      }
    };
  };
}
