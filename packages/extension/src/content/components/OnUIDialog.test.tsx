import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { OnUIDialog } from "./OnUIDialog";

describe("OnUIDialog", () => {
    beforeAll(() => {
        const cssApi = (
            globalThis as unknown as {
                CSS?: { escape?: (value: string) => string };
            }
        ).CSS;
        if (!cssApi) {
            (
                globalThis as unknown as {
                    CSS: { escape: (value: string) => string };
                }
            ).CSS = {
                escape: (value: string) => value,
            };
            return;
        }

        if (typeof cssApi.escape !== "function") {
            cssApi.escape = (value: string) => value;
        }
    });

    it("prevents duplicate saves while save is in flight", async () => {
        const user = userEvent.setup();
        const target = document.createElement("button");
        target.id = "submit";
        document.body.appendChild(target);

        let resolveSave: (() => void) | undefined;
        const savePromise = new Promise<void>((resolve) => {
            resolveSave = () => resolve();
        });
        const onSave = vi.fn(() => savePromise);

        render(
            <OnUIDialog element={target} onSave={onSave} onCancel={() => {}} />,
        );

        const textarea = screen.getByPlaceholderText(
            "Describe the issue or feedback...",
        );
        await user.type(textarea, "Need to fix spacing");

        const addButton = screen.getByRole("button", {
            name: "Add Annotation",
        });
        await user.click(addButton);

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledTimes(1);
        });

        const savingButton = await screen.findByRole("button", {
            name: "Saving...",
        });
        expect((savingButton as HTMLButtonElement).disabled).toBe(true);

        await user.click(savingButton);
        expect(onSave).toHaveBeenCalledTimes(1);

        if (!resolveSave) {
            throw new Error("Save resolver was not initialized");
        }
        resolveSave();

        await waitFor(() => {
            expect(
                (
                    screen.getByRole("button", {
                        name: "Add Annotation",
                    }) as HTMLButtonElement
                ).disabled,
            ).toBe(false);
        });
    });

    it("defaults intent to change when adding a new annotation", () => {
        const target = document.createElement("button");
        target.id = "submit";
        document.body.appendChild(target);

        render(
            <OnUIDialog
                element={target}
                onSave={() => {}}
                onCancel={() => {}}
            />,
        );

        expect(
            screen.getByRole("button", { name: "Intent: Change (selected)" }),
        ).toBeTruthy();
    });

    it("renders a complete button for new annotations", () => {
        const target = document.createElement("button");
        target.id = "submit";
        document.body.appendChild(target);

        render(
            <OnUIDialog
                element={target}
                onSave={() => {}}
                onComplete={() => {}}
                onCancel={() => {}}
            />,
        );

        expect(
            screen.getByRole("button", {
                name: "Complete",
            }),
        ).toBeTruthy();
    });

    it("runs complete without invoking the normal save handler", async () => {
        const user = userEvent.setup();
        const target = document.createElement("button");
        target.id = "submit";
        document.body.appendChild(target);

        const onSave = vi.fn();
        const onComplete = vi.fn();

        render(
            <OnUIDialog
                element={target}
                onSave={onSave}
                onComplete={onComplete}
                onCancel={() => {}}
            />,
        );

        const textarea = screen.getByPlaceholderText(
            "Describe the issue or feedback...",
        );
        await user.type(textarea, "Need to fix spacing");
        await user.click(screen.getByRole("button", { name: "Complete" }));

        expect(onSave).not.toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledWith({
            comment: "Need to fix spacing",
            intent: "change",
            severity: undefined,
        });
    });

    it("preserves the provided intent when editing an annotation", () => {
        const target = document.createElement("button");
        target.id = "submit";
        document.body.appendChild(target);

        render(
            <OnUIDialog
                element={target}
                initialIntent="fix"
                isEditing
                onSave={() => {}}
                onCancel={() => {}}
            />,
        );

        expect(
            screen.getByRole("button", { name: "Intent: Fix (selected)" }),
        ).toBeTruthy();
    });

    it("adds tooltips to icon-only dialog actions", async () => {
        const user = userEvent.setup();
        const target = document.createElement("button");
        target.id = "submit";
        document.body.appendChild(target);

        const second = document.createElement("div");
        second.id = "secondary";
        document.body.appendChild(second);

        render(
            <OnUIDialog
                element={target}
                multiTargets={[target, second]}
                onRemoveTarget={() => {}}
                onSave={() => {}}
                onCancel={() => {}}
            />,
        );

        expect(screen.getByTitle("Close annotation dialog")).toBeTruthy();
        expect(screen.getByTitle("Remove target 1")).toBeTruthy();

        await user.click(screen.getByTitle("Remove target 1"));
    });
});
