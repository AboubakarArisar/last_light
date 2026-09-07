import { test } from "node:test";
import assert from "node:assert/strict";
import { Drawing } from "../src/input.ts";
import { Simulation, type Kick } from "../src/simulation.ts";
import { levels } from "../src/levels.ts";

test("pointer input rejects accidental/secondary touches, captures one pointer and cancels cleanly", () => {
  Object.assign(globalThis, {
    innerWidth: 1000,
    innerHeight: 700,
    devicePixelRatio: 1,
  });
  class Canvas extends EventTarget {
    captured: number | null = null;
    width = 0;
    height = 0;
    getContext() {
      return { setTransform() {} };
    }
    setPointerCapture(id: number) {
      this.captured = id;
    }
    hasPointerCapture(id: number) {
      return this.captured === id;
    }
    releasePointerCapture() {
      this.captured = null;
    }
  }
  const canvas = new Canvas();
  const sim = new Simulation(levels[0]);
  const messages: string[] = [];
  const kicks: Kick[] = [];
  const view = {
    cameraFrozen: false,
    width: 1000,
    project: (p: { x: number }) => ({ x: p.x === 3 ? 300 : 100, y: 100 }),
    unproject: (_x: number, _y: number, goal = false) =>
      goal ? null : { x: 3, y: 0.11, z: 15 },
  };
  const drawing = new Drawing(
    canvas as unknown as HTMLCanvasElement,
    view as any,
    () => sim,
    (k) => kicks.push(k),
    (s) => messages.push(s),
  );
  drawing.enabled = true;
  const pointer = (x: number, id = 1, primary = true) =>
    ({
      clientX: x,
      clientY: 100,
      pointerId: id,
      isPrimary: primary,
      preventDefault() {},
    }) as PointerEvent;
  try {
    drawing.down(pointer(900));
    assert.equal(drawing.pointer, null);
    assert.equal(messages.length, 1);
    drawing.down(pointer(100, 2, false));
    assert.equal(drawing.pointer, null);
    drawing.down(pointer(100));
    assert.equal(canvas.captured, 1);
    assert.ok(view.cameraFrozen);
    drawing.down(pointer(100, 2));
    assert.equal(drawing.pointer, 1);
    drawing.up(pointer(105));
    assert.equal(kicks.length, 0);
    assert.equal(canvas.captured, null);
    drawing.down(pointer(100));
    drawing.move(pointer(180));
    drawing.up(pointer(300));
    assert.equal(kicks.length, 1);
    assert.equal(kicks[0].receiver, 1);
    assert.equal(kicks[0].shot, false);
    assert.equal(view.cameraFrozen, false);
    // An empty patch of grass is a valid destination, even without a receiver.
    drawing.submit([{ x: 100, y: 100, t: 0 }, { x: 900, y: 100, t: 500 }]);
    assert.equal(kicks.length, 2);
    assert.equal(kicks[1].receiver, -1);
    assert.deepEqual(kicks[1].target, { x: 3, y: 0.11, z: 15 });
    view.unproject = (_x, _y, goal = false) =>
      goal ? { x: 12, y: 6, z: 0 } : null;
    drawing.submit([{ x: 100, y: 100, t: 0 }, { x: 900, y: 10, t: 500 }]);
    assert.equal(kicks.length, 3);
    assert.equal(kicks[2].shot, true);
    assert.deepEqual(kicks[2].target, { x: 12, y: 6, z: -0.08 });
    drawing.down(pointer(100));
    drawing.cancel();
    assert.equal(drawing.pointer, null);
    assert.equal(canvas.captured, null);
  } finally {
    drawing.dispose();
  }
});
