import { expect, test } from "bun:test";
import { createQueue } from "../src/bases/media-queue";

const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

test("runs at most the limit at once and starts the next as slots free", async () => {
  const enqueue = createQueue(2);
  const gates = [gate(), gate(), gate()];
  const started: number[] = [];
  for (const [i, g] of gates.entries()) enqueue(async () => { started.push(i); await g.p; });
  expect(started).toEqual([0, 1]);
  gates[0]!.open();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(started).toEqual([0, 1, 2]);
  gates[1]!.open();
  gates[2]!.open();
});

test("a cancelled waiting task never runs", async () => {
  const enqueue = createQueue(1);
  const g = gate();
  const started: number[] = [];
  enqueue(async () => { started.push(0); await g.p; });
  const cancel = enqueue(async () => { started.push(1); });
  cancel();
  g.open();
  await new Promise((r) => setTimeout(r, 5));
  expect(started).toEqual([0]);
});

test("a failing task frees its slot", async () => {
  const enqueue = createQueue(1);
  const started: number[] = [];
  enqueue(async () => { throw new Error("x"); });
  enqueue(async () => { started.push(1); });
  await new Promise((r) => setTimeout(r, 5));
  expect(started).toEqual([1]);
});
