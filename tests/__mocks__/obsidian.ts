// Mock for the 'obsidian' module providing minimal API surface for tests

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function moment(_inp?: any): any {
    return {
        format: (_fmt?: string) => "2024-01-01 00:00:00",
    };
}

export const Platform = {
    isDesktopApp: false,
    isMobileApp: true,
    isDesktop: false,
    isMacOS: false,
    isWin: false,
    isLinux: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Notice: any = function (
    this: { hide: () => void },
    _message: string,
    _timeout?: number
) {
    this.hide = () => {};
    return this;
};

export function normalizePath(path: string): string {
    return path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

export class TFile {
    path: string;
    basename: string;
    extension: string;
    stat: { ctime: number; mtime: number; size: number };
    parent: { path: string } | null = null;

    constructor(path: string, stat = { ctime: 0, mtime: 0, size: 0 }) {
        this.path = path;
        this.basename = path.split("/").pop() || path;
        this.extension = path.includes(".") ? path.split(".").pop() || "" : "";
        this.stat = stat;
    }
}

export class TFolder {
    path: string;
    isRoot: boolean;

    constructor(path: string) {
        this.path = path;
        this.isRoot = path === "/";
    }
}

export class PluginSettingTab {
    app: unknown;
    plugin: unknown;
    containerEl: unknown;

    constructor(app: unknown, plugin: unknown) {
        this.app = app;
        this.plugin = plugin;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Setting: any = function () {
    return {
        setName: () => this,
        setDesc: () => this,
        addText: () => this,
        addButton: () => this,
        addToggle: () => this,
        addDropdown: () => this,
        addTextArea: () => this,
        addSlider: () => this,
        addExtraButton: () => this,
    };
};

export class Plugin {
    app: unknown;
    manifest: { id: string; name: string };

    constructor() {
        this.manifest = { id: "obsidian-git", name: "obsidian-git" };
    }

    loadData(): Promise<unknown> {
        return Promise.resolve(null);
    }

    saveData(_data: unknown): Promise<void> {
        return Promise.resolve();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addCommand(_command: any): void {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addStatusBarItem(): any {
        return {
            setText: () => {},
            addClass: () => {},
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
    }

    registerEvent(_event: unknown): void {}
    registerView(_type: string, _viewCreator: unknown): void {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addRibbonIcon(_icon: string, _title: string, _callback: any): void {}
    registerObsidianProtocolHandler(_handler: string, _callback: unknown): void {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerInterval(_interval: any): void {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerDomEvent(_el: any, _event: string, _callback: any): void {}
}

export const requestUrl = async (_req: unknown): Promise<unknown> => {
    return {
        status: 200,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        text: "",
        json: {},
    };
};

export function htmlToMarkdown(_html: string): string {
    return "";
}
