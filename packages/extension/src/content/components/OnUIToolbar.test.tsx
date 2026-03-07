import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import type { Annotation } from "@/types";
import { OnUIToolbar } from "./OnUIToolbar";
import { copyToClipboard } from "../utils/clipboard";

vi.mock("../utils/clipboard", () => ({
    copyToClipboard: vi.fn(async () => true),
}));

vi.mock("../utils/output-generation", () => ({
    generateOutput: vi.fn(() => "copied annotation output"),
}));

function createAnnotation(id: string): Annotation {
    return {
        id,
        selector: `#annotation-${id}`,
        elementPath: `div > #annotation-${id}`,
        tagName: "div",
        comment: `Annotation ${id}`,
        boundingBox: {
            top: 0,
            left: 0,
            width: 100,
            height: 20,
            isFixed: false,
        },
        createdAt: 1,
        updatedAt: 1,
        pageUrl: "https://example.com",
        pageTitle: "Example",
        attributes: {},
    };
}

function renderToolbar({
    isAnnotateMode = false,
    multiSelectCount = 0,
    onToggleAnnotateMode = vi.fn(),
    clearOnCopy = false,
    onClearOnCopyChange = vi.fn(),
    onClearAnnotations = vi.fn(),
    onComplete = vi.fn(),
    annotations = [],
}: {
    isAnnotateMode?: boolean;
    multiSelectCount?: number;
    onToggleAnnotateMode?: () => void | Promise<boolean>;
    clearOnCopy?: boolean;
    onClearOnCopyChange?: (enabled: boolean) => void;
    onClearAnnotations?: () => void | Promise<void>;
    onComplete?: () => void | Promise<void>;
    annotations?: Annotation[];
} = {}) {
    render(
        <OnUIToolbar
            isAnnotateMode={isAnnotateMode}
            multiSelectCount={multiSelectCount}
            onToggleAnnotateMode={onToggleAnnotateMode}
            annotations={annotations}
            outputLevel="standard"
            onOutputLevelChange={vi.fn()}
            clearOnCopy={clearOnCopy}
            onClearOnCopyChange={onClearOnCopyChange}
            onClearAnnotations={onClearAnnotations}
            onComplete={onComplete}
        />,
    );
}

describe("OnUIToolbar", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(copyToClipboard).mockResolvedValue(true);
    });

    it("shows Shift multi-select guidance when annotate mode is active", async () => {
        renderToolbar({ isAnnotateMode: true, multiSelectCount: 0 });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));

        expect(
            screen.getByText(
                "Tip: hold Shift and click to multi-select elements.",
            ),
        ).toBeTruthy();
    });

    it("auto-enables annotate mode when the panel is expanded from collapsed", async () => {
        const onToggleAnnotateMode = vi.fn();
        renderToolbar({ isAnnotateMode: false, onToggleAnnotateMode });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));

        expect(onToggleAnnotateMode).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("button", { name: "Annotating..." })).toBeTruthy();
        expect(
            screen.getByText(
                "Tip: hold Shift and click to multi-select elements.",
            ),
        ).toBeTruthy();
    });

    it("does not auto-toggle annotate mode when already annotating", async () => {
        const onToggleAnnotateMode = vi.fn();
        renderToolbar({ isAnnotateMode: true, onToggleAnnotateMode });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));

        expect(onToggleAnnotateMode).not.toHaveBeenCalled();
    });

    it("shows selected count guidance while multi-select is in progress", async () => {
        renderToolbar({ isAnnotateMode: true, multiSelectCount: 3 });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));

        expect(
            screen.getByText(
                "Shift multi-select: 3 selected. Release Shift to annotate all.",
            ),
        ).toBeTruthy();
    });

    it("shows Shift guidance after auto-starting annotate mode on expand", async () => {
        renderToolbar({ isAnnotateMode: false, multiSelectCount: 4 });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));

        expect(
            screen.getByText(
                "Shift multi-select: 4 selected. Release Shift to annotate all.",
            ),
        ).toBeTruthy();
    });

    it("exits annotate mode on Escape", async () => {
        const onToggleAnnotateMode = vi.fn();
        renderToolbar({ isAnnotateMode: true, onToggleAnnotateMode });
        const user = userEvent.setup();

        await user.keyboard("{Escape}");

        expect(onToggleAnnotateMode).toHaveBeenCalledTimes(1);
    });

    it("clears annotations after successful copy when clear-on-copy is enabled", async () => {
        const onClearAnnotations = vi.fn();
        renderToolbar({
            clearOnCopy: true,
            onClearAnnotations,
            annotations: [createAnnotation("1")],
        });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));
        await user.click(screen.getByText("Copy"));

        expect(onClearAnnotations).toHaveBeenCalledTimes(1);
    });

    it("updates clear-on-copy setting from settings panel checkbox", async () => {
        const onClearOnCopyChange = vi.fn();
        renderToolbar({ onClearOnCopyChange });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));
        await user.click(screen.getByText("Settings"));
        await user.click(screen.getByLabelText("Clear On Copy"));

        expect(onClearOnCopyChange).toHaveBeenCalledWith(true);
    });

    it("copies annotations before invoking complete", async () => {
        const onComplete = vi.fn();
        renderToolbar({
            onComplete,
            annotations: [createAnnotation("1")],
        });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));
        await user.click(screen.getByText("Complete"));

        expect(copyToClipboard).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("does not invoke complete when copy fails", async () => {
        vi.mocked(copyToClipboard).mockResolvedValueOnce(false);
        const onComplete = vi.fn();
        renderToolbar({
            onComplete,
            annotations: [createAnnotation("1")],
        });
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));
        await user.click(screen.getByText("Complete"));

        expect(onComplete).not.toHaveBeenCalled();
    });

    it("disables complete when there are no annotations", async () => {
        renderToolbar();
        const user = userEvent.setup();

        await user.click(screen.getByTitle("Toggle onUI panel"));

        expect(
            (
                screen.getByRole("button", {
                    name: "Complete",
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
    });

    it("adds tooltips to toolbar actions", async () => {
        renderToolbar({ annotations: [createAnnotation("1")] });
        const user = userEvent.setup();

        expect(screen.getByTitle("Toggle onUI panel")).toBeTruthy();

        await user.click(screen.getByTitle("Toggle onUI panel"));

        expect(screen.getByTitle("Toggle annotate mode")).toBeTruthy();
        expect(screen.getByTitle("Copy annotations")).toBeTruthy();
        expect(screen.getByTitle("Clear annotations")).toBeTruthy();
        expect(
            screen.getByTitle("Copy, clear, and exit annotate mode"),
        ).toBeTruthy();
        expect(screen.getByTitle("Open settings")).toBeTruthy();
    });
});
