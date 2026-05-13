import type ObsidianGit from "./main";

export class TimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Task timed out after ${timeoutMs}ms`);
        this.name = "TimeoutError";
    }
}

export interface PromiseQueueOptions {
    /** Default timeout in ms. 0 = no timeout. */
    defaultTimeoutMs: number;
}

export interface TaskOptions {
    /** Per-task timeout in ms. Overrides the queue default. 0 = no timeout. */
    timeoutMs?: number;
}

export interface TaskContext {
    /** Aborted when the task times out. */
    signal: AbortSignal;
}

type TaskFn<T> = (ctx: TaskContext) => Promise<T>;

interface QueuedTask {
    fn: (ctx: TaskContext) => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeoutMs: number;
    signal: AbortSignal;
    abortController: AbortController;
    onFinished?: (res: unknown) => void;
}

export class PromiseQueue {
    private tasks: QueuedTask[] = [];
    private readonly defaultTimeoutMs: number;

    // Legacy interface
    private legacyTasks: {
        task: () => Promise<unknown>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onFinished: (res: any) => void;
    }[] = [];

    constructor(
        private readonly plugin: ObsidianGit,
        options: PromiseQueueOptions = { defaultTimeoutMs: 0 }
    ) {
        this.defaultTimeoutMs = options.defaultTimeoutMs;
    }

    /**
     * Add a task to the queue (legacy API, returns void).
     * For new code, prefer addTaskAsync which returns a Promise.
     */
    addTask<T>(
        task: () => Promise<T>,
        onFinished?: (res: T | undefined) => void
    ): void {
        this.legacyTasks.push({
            task,
            onFinished: onFinished ?? (() => {}),
        });
        if (this.legacyTasks.length === 1 && this.tasks.length === 0) {
            this.handleLegacyTask();
        }
    }

    /**
     * Add a task and return a Promise that resolves with the task result.
     * Supports per-task timeout and receives an AbortSignal.
     */
    addTaskAsync<T>(
        fn: TaskFn<T>,
        options: TaskOptions = {}
    ): Promise<T> {
        const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
        const abortController = new AbortController();

        return new Promise<T>((resolve, reject) => {
            this.tasks.push({
                fn: fn as (ctx: TaskContext) => Promise<unknown>,
                resolve: resolve as (value: unknown) => void,
                reject,
                timeoutMs,
                signal: abortController.signal,
                abortController,
            });

            // If this is the only task and no legacy task is currently running,
            // start processing.
            if (
                this.tasks.length === 1 &&
                this.legacyTasks.length === 0
            ) {
                this.handleTask();
            }
        });
    }

    private handleLegacyTask(): void {
        if (this.legacyTasks.length === 0) {
            // No more legacy tasks, try the async queue
            this.handleTask();
            return;
        }

        const item = this.legacyTasks[0];
        item.task().then(
            (res) => {
                item.onFinished(res);
                this.legacyTasks.shift();
                this.handleLegacyTask();
            },
            (e) => {
                this.plugin.displayError(e);
                item.onFinished(undefined);
                this.legacyTasks.shift();
                this.handleLegacyTask();
            }
        );
    }

    private handleTask(): void {
        if (this.tasks.length === 0) {
            // No async tasks, check legacy queue
            if (this.legacyTasks.length > 0) {
                this.handleLegacyTask();
            }
            return;
        }

        const item = this.tasks[0];
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const timeoutPromise =
            item.timeoutMs > 0
                ? new Promise<never>((_, reject) => {
                      timeoutId = setTimeout(() => {
                          item.abortController.abort();
                          reject(new TimeoutError(item.timeoutMs));
                      }, item.timeoutMs);
                  })
                : null;

        const taskPromise = item.fn({ signal: item.signal });

        const race = timeoutPromise
            ? Promise.race([taskPromise, timeoutPromise])
            : taskPromise;

        race.then(
            (res) => {
                if (timeoutId !== undefined) clearTimeout(timeoutId);
                item.resolve(res);
                this.tasks.shift();
                this.handleTask();
            },
            (e) => {
                if (timeoutId !== undefined) clearTimeout(timeoutId);
                // Don't call displayError for TimeoutError — the caller
                // handles it via the rejected Promise.
                if (!(e instanceof TimeoutError)) {
                    this.plugin.displayError(e);
                }
                item.reject(e);
                this.tasks.shift();
                this.handleTask();
            }
        );
    }

    clear(): void {
        this.tasks = [];
        this.legacyTasks = [];
    }
}
