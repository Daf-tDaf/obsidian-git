import { describe, expect, test, vi, beforeEach } from "vitest";
import { PromiseQueue } from "../src/promiseQueue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObsidianGit = any;

function createMockPlugin(): AnyObsidianGit {
    return {
        displayError: vi.fn(),
        log: vi.fn(),
        manifest: { id: "obsidian-git", name: "obsidian-git" },
    };
}

function createPluginWithDisplayError(): AnyObsidianGit & {
    displayError: ReturnType<typeof vi.fn>;
} {
    return {
        displayError: vi.fn(),
        log: vi.fn(),
        manifest: { id: "obsidian-git", name: "obsidian-git" },
    };
}

// ── Current behavior (regression tests) ──────────────────────────

describe("PromiseQueue (current behavior)", () => {
    let queue: PromiseQueue;
    let plugin: ReturnType<typeof createMockPlugin>;

    beforeEach(() => {
        plugin = createMockPlugin();
        queue = new PromiseQueue(plugin);
    });

    test("executes tasks sequentially", async () => {
        const order: number[] = [];

        queue.addTask(async () => {
            order.push(1);
            await new Promise((r) => setTimeout(r, 20));
            order.push(2);
        });

        queue.addTask(async () => {
            order.push(3);
        });

        queue.addTask(async () => {
            order.push(4);
        });

        await new Promise((r) => setTimeout(r, 100));
        expect(order).toEqual([1, 2, 3, 4]);
    });

    test("calls onFinished with result on success", async () => {
        const onFinished = vi.fn();
        queue.addTask(async () => "result", onFinished);
        await new Promise((r) => setTimeout(r, 10));
        expect(onFinished).toHaveBeenCalledWith("result");
    });

    test("calls onFinished with undefined on error and calls displayError", async () => {
        const onFinished = vi.fn();
        queue.addTask(async () => {
            throw new Error("task failed");
        }, onFinished);
        await new Promise((r) => setTimeout(r, 10));
        expect(onFinished).toHaveBeenCalledWith(undefined);
        expect(plugin.displayError).toHaveBeenCalled();
    });

    test("continues executing next task after error", async () => {
        const order: number[] = [];
        queue.addTask(async () => {
            order.push(1);
            throw new Error("fail");
        });
        queue.addTask(async () => {
            order.push(2);
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual([1, 2]);
    });

    test("clear empties pending tasks after current task finishes", async () => {
        const executed: number[] = [];
        queue.addTask(async () => {
            executed.push(1);
            await new Promise((r) => setTimeout(r, 50));
            executed.push(2);
        });
        queue.addTask(async () => {
            executed.push(3);
        });
        await new Promise((r) => setTimeout(r, 10));
        queue.clear();
        await new Promise((r) => setTimeout(r, 100));
        expect(executed).toEqual([1, 2]);
    });
});

// ── addTaskAsync ─────────────────────────────────────────────────
// New method that returns a Promise, enabling await/error-propagation.

describe("addTaskAsync", () => {
    let queue: PromiseQueue;
    let plugin: ReturnType<typeof createPluginWithDisplayError>;

    beforeEach(() => {
        plugin = createPluginWithDisplayError();
        queue = new PromiseQueue(plugin);
    });

    test("returns a Promise that resolves with the task result", async () => {
        const result = await queue.addTaskAsync(async () => 42);
        expect(result).toBe(42);
    });

    test("rejects if the task throws", async () => {
        await expect(
            queue.addTaskAsync(async () => {
                throw new Error("boom");
            })
        ).rejects.toThrow("boom");
    });

    test("tasks execute sequentially with other tasks", async () => {
        const order: number[] = [];

        const p1 = queue.addTaskAsync(async () => {
            order.push(1);
            await new Promise((r) => setTimeout(r, 30));
            order.push(2);
            return "a";
        });

        const p2 = queue.addTaskAsync(async () => {
            order.push(3);
            return "b";
        });

        queue.addTask(async () => {
            order.push(4);
        });

        const [r1, r2] = await Promise.all([p1, p2]);
        await new Promise((r) => setTimeout(r, 20));

        expect(order).toEqual([1, 2, 3, 4]);
        expect(r1).toBe("a");
        expect(r2).toBe("b");
    });

    test("error in addTaskAsync does not block subsequent tasks", async () => {
        const order: number[] = [];

        await expect(
            queue.addTaskAsync(async () => {
                order.push(1);
                throw new Error("fail");
            })
        ).rejects.toThrow("fail");

        const result = await queue.addTaskAsync(async () => {
            order.push(2);
            return "ok";
        });

        expect(order).toEqual([1, 2]);
        expect(result).toBe("ok");
    });
});

// ── Timeout ──────────────────────────────────────────────────────

describe("Task timeout", () => {
    let queue: PromiseQueue;
    let plugin: ReturnType<typeof createPluginWithDisplayError>;

    beforeEach(() => {
        plugin = createPluginWithDisplayError();
        queue = new PromiseQueue(plugin, { defaultTimeoutMs: 60_000 });
    });

    test("rejects with TimeoutError when task exceeds per-task timeout", async () => {
        await expect(
            queue.addTaskAsync(
                async () => {
                    await new Promise(() => {}); // never resolves
                },
                { timeoutMs: 100 }
            )
        ).rejects.toThrow("timed out");
    });

    test("resolves normally when task completes within timeout", async () => {
        const result = await queue.addTaskAsync(
            async () => {
                await new Promise((r) => setTimeout(r, 30));
                return "done";
            },
            { timeoutMs: 500 }
        );
        expect(result).toBe("done");
    });

    test("after a timeout, the next queued task executes normally", async () => {
        const order: number[] = [];

        await expect(
            queue.addTaskAsync(
                async () => {
                    order.push(1);
                    await new Promise(() => {}); // hangs forever
                },
                { timeoutMs: 50 }
            )
        ).rejects.toThrow("timed out");

        const result = await queue.addTaskAsync(async () => {
            order.push(2);
            return "recovered";
        });

        expect(order).toEqual([1, 2]);
        expect(result).toBe("recovered");
    });

    test("timeout=0 means no timeout", async () => {
        const result = await queue.addTaskAsync(
            async () => {
                await new Promise((r) => setTimeout(r, 30));
                return "no-rush";
            },
            { timeoutMs: 0 }
        );
        expect(result).toBe("no-rush");
    });

    test("uses queue default timeout when per-task timeout is not set", async () => {
        const queue2 = new PromiseQueue(plugin, { defaultTimeoutMs: 100 });

        await expect(
            queue2.addTaskAsync(async () => {
                await new Promise(() => {}); // never resolves
            })
        ).rejects.toThrow("timed out");
    });

    test("timeout fires on the task itself, not on queue wait time", async () => {
        // Task 1 takes 80ms, Task 2 has a 60ms timeout.
        // If timeout measured from enqueue-time, it would fire during Task 1.
        // If timeout measures own execution time, it has 60ms of its own.
        const results: string[] = [];

        queue.addTask(async () => {
            await new Promise((r) => setTimeout(r, 80));
            results.push("t1-done");
        });

        const p2 = queue.addTaskAsync(
            async () => {
                await new Promise((r) => setTimeout(r, 20));
                results.push("t2-done");
                return "t2";
            },
            { timeoutMs: 60 }
        );

        const r2 = await p2;
        expect(r2).toBe("t2");
        expect(results).toEqual(["t1-done", "t2-done"]);
    });
});

// ── AbortSignal ──────────────────────────────────────────────────

describe("AbortSignal support", () => {
    let queue: PromiseQueue;
    let plugin: ReturnType<typeof createPluginWithDisplayError>;

    beforeEach(() => {
        plugin = createPluginWithDisplayError();
        queue = new PromiseQueue(plugin);
    });

    test("passes AbortSignal to task function", async () => {
        const receivedSignal: AbortSignal | undefined = undefined;
        const captured = { signal: receivedSignal };

        await queue.addTaskAsync(async ({ signal }) => {
            captured.signal = signal;
            return "ok";
        });

        expect(captured.signal).toBeDefined();
        expect(captured.signal?.aborted).toBe(false);
    });

    test("on timeout, AbortSignal is aborted", async () => {
        const captured = { aborted: false };

        await expect(
            queue.addTaskAsync(
                async ({ signal }) => {
                    signal.addEventListener("abort", () => {
                        captured.aborted = true;
                    });
                    await new Promise(() => {}); // never resolves
                },
                { timeoutMs: 50 }
            )
        ).rejects.toThrow();

        // Signal should have been aborted
        expect(captured.aborted).toBe(true);
    });

    test("task can check signal.aborted to short-circuit work", async () => {
        const iterations: number[] = [];

        await expect(
            queue.addTaskAsync(
                async ({ signal }) => {
                    for (let i = 0; i < 100; i++) {
                        if (signal.aborted) {
                            return; // early exit
                        }
                        iterations.push(i);
                        await new Promise((r) => setTimeout(r, 5));
                    }
                },
                { timeoutMs: 30 }
            )
        ).rejects.toThrow();

        // Should have broken out of the loop early
        expect(iterations.length).toBeLessThan(100);
        expect(iterations.length).toBeGreaterThan(0);
    });

    test("signal is not aborted on successful completion", async () => {
        const captured = { aborted: false };

        await queue.addTaskAsync(async ({ signal }) => {
            signal.addEventListener("abort", () => {
                captured.aborted = true;
            });
            return "success";
        });

        expect(captured.aborted).toBe(false);
    });
});

// ── Backwards compatibility ──────────────────────────────────────

describe("Backwards compatibility", () => {
    let queue: PromiseQueue;
    let plugin: ReturnType<typeof createPluginWithDisplayError>;

    beforeEach(() => {
        plugin = createPluginWithDisplayError();
        queue = new PromiseQueue(plugin);
    });

    test("addTask still works exactly as before (void return)", () => {
        // addTask returns void, same as pre-Stage-1
        const result = queue.addTask(async () => 42);
        expect(result).toBeUndefined();
    });

    test("addTask tasks that throw still call displayError", async () => {
        queue.addTask(async () => {
            throw new Error("legacy-error");
        });
        await new Promise((r) => setTimeout(r, 10));
        expect(plugin.displayError).toHaveBeenCalled();
    });

    test("addTask with onFinished still works", async () => {
        const onFinished = vi.fn();
        queue.addTask(async () => "legacy", onFinished);
        await new Promise((r) => setTimeout(r, 10));
        expect(onFinished).toHaveBeenCalledWith("legacy");
    });

    test("addTask does not accept timeout or signal options", () => {
        // This is a compile-time check: addTask signature should not change.
        // At runtime, extra args are ignored.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = (queue as any).addTask(async () => {}, () => {}, {
            timeoutMs: 100,
        });
        expect(result).toBeUndefined();
    });

    test("PromiseQueue with default options (no timeout) works", async () => {
        const q = new PromiseQueue(plugin);
        const result = await q.addTaskAsync(async () => "ok");
        expect(result).toBe("ok");
    });
});
