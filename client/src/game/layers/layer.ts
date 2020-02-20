import { SyncMode, InvalidationMode } from "@/core/comm/types";
import { socket } from "@/game/api/socket";
import { ServerShape } from "@/game/comm/types/shapes";
import { EventBus } from "@/game/event-bus";
import { layerManager } from "@/game/layers/manager";
import { Shape } from "@/game/shapes/shape";
import { createShapeFromDict } from "@/game/shapes/utils";
import { gameStore } from "@/game/store";
import { visibilityStore } from "../visibility/store";
import { getVisionSources, getBlockers, sliceVisionSources, sliceBlockers } from "../visibility/utils";
import { TriangulationTarget } from "../visibility/te/pa";

export class Layer {
    name: string;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    floor: string;

    selectable = false;
    playerEditable = false;
    isVisionLayer = false;

    // When set to false, the layer will be redrawn on the next tick
    valid = false;
    // The collection of shapes that this layer contains.
    // These are ordered on a depth basis.
    shapes: Shape[] = [];

    // Collection of shapes that are currently selected
    selection: Shape[] = [];

    // Extra selection highlighting settings
    selectionColor = "#CC0000";
    selectionWidth = 2;

    points: Map<string, Set<string>> = new Map();
    postDrawCallbacks: (() => void)[] = [];

    constructor(canvas: HTMLCanvasElement, name: string, floor: string) {
        this.canvas = canvas;
        this.name = name;
        this.width = canvas.width;
        this.height = canvas.height;
        this.ctx = canvas.getContext("2d")!;
        this.floor = floor;
    }

    invalidate(skipLightUpdate: boolean): void {
        this.valid = false;
        if (!skipLightUpdate) {
            layerManager.invalidateLight(this.floor);
        }
    }

    addShape(shape: Shape, sync: SyncMode, invalidate: InvalidationMode, snappable = true): void {
        shape.layer = this.name;
        shape.floor = this.floor;
        this.shapes.push(shape);
        layerManager.UUIDMap.set(shape.uuid, shape);
        shape.checkVisionSources(invalidate !== InvalidationMode.NO);
        shape.setMovementBlock(shape.movementObstruction, invalidate !== InvalidationMode.NO);
        if (snappable) {
            for (const point of shape.points) {
                const strp = JSON.stringify(point);
                this.points.set(strp, (this.points.get(strp) || new Set()).add(shape.uuid));
            }
        }
        if (shape.ownedBy(gameStore.username) && shape.isToken) gameStore.ownedtokens.push(shape.uuid);
        if (shape.annotation.length) gameStore.annotations.push(shape.uuid);
        if (sync !== SyncMode.NO_SYNC)
            socket.emit("Shape.Add", { shape: shape.asDict(), temporary: sync === SyncMode.TEMP_SYNC });
        if (invalidate) this.invalidate(invalidate === InvalidationMode.WITH_LIGHT);
    }

    setShapes(shapes: ServerShape[]): void {
        for (const serverShape of shapes) {
            const shape = createShapeFromDict(serverShape);
            if (shape === undefined) {
                console.log(`Shape with unknown type ${serverShape.type_} could not be added`);
                return;
            }
            this.addShape(shape, SyncMode.NO_SYNC, InvalidationMode.NO);
        }
        this.clearSelection(); // TODO: Fix keeping selection on those items that are not moved.
    }

    removeShape(shape: Shape, sync: SyncMode): void {
        const idx = this.shapes.indexOf(shape);
        if (idx < 0) {
            console.error("attempted to remove shape not in layer.");
            return;
        }
        this.shapes.splice(idx, 1);

        if (sync !== SyncMode.NO_SYNC)
            socket.emit("Shape.Remove", { shape: shape.asDict(), temporary: sync === SyncMode.TEMP_SYNC });

        const visionSources = getVisionSources(this.floor);
        const visionBlockers = getBlockers(TriangulationTarget.VISION, this.floor);
        const movementBlockers = getBlockers(TriangulationTarget.MOVEMENT, this.floor);

        const lsI = visionSources.findIndex(ls => ls.shape === shape.uuid);
        const lbI = visionBlockers.findIndex(ls => ls === shape.uuid);
        const mbI = movementBlockers.findIndex(ls => ls === shape.uuid);
        const anI = gameStore.annotations.findIndex(ls => ls === shape.uuid);

        if (lsI >= 0) sliceVisionSources(lsI, this.floor);
        if (lbI >= 0) sliceBlockers(TriangulationTarget.VISION, lbI, this.floor);
        if (mbI >= 0) sliceBlockers(TriangulationTarget.MOVEMENT, mbI, this.floor);
        if (anI >= 0) gameStore.annotations.splice(anI, 1);

        const annotationIndex = gameStore.annotations.indexOf(shape.uuid);
        if (annotationIndex >= 0) gameStore.annotations.splice(annotationIndex, 1);

        const ownedIndex = gameStore.ownedtokens.indexOf(shape.uuid);
        if (ownedIndex >= 0) gameStore.ownedtokens.splice(ownedIndex, 1);

        layerManager.UUIDMap.delete(shape.uuid);

        for (const point of shape.points) {
            const strp = JSON.stringify(point);
            const val = this.points.get(strp);
            if (val === undefined || val.size === 1) this.points.delete(strp);
            else val.delete(shape.uuid);
        }

        const index = this.selection.indexOf(shape);
        if (index >= 0) this.selection.splice(index, 1);
        if (lbI >= 0) visibilityStore.recalculateVision(this.floor);
        if (mbI >= 0) visibilityStore.recalculateMovement(this.floor);
        this.invalidate(!sync);
    }

    clear(): void {
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    clearSelection(): void {
        this.selection = [];
        EventBus.$emit("SelectionInfo.Shape.Set", null);
    }

    hide(): void {
        this.canvas.style.display = "none";
    }

    show(): void {
        this.canvas.style.removeProperty("display");
    }

    draw(doClear = true): void {
        if (!this.valid) {
            const ctx = this.ctx;
            const ogOP = ctx.globalCompositeOperation;

            if (doClear) this.clear();

            // We iterate twice over all shapes
            // First to draw the auras and a second time to draw the shapes themselves
            // Otherwise auras from one shape could be overlapping another shape itself.

            for (const shape of this.shapes) {
                if (shape.options.has("skipDraw") && shape.options.get("skipDraw")) continue;
                if (layerManager.getLayer(this.floor) === undefined) continue;
                if (!shape.visibleInCanvas(this.canvas)) continue;
                if (this.name === "fow" && layerManager.getLayer(this.floor)!.name !== this.name) continue;
                shape.drawAuras(ctx);
            }
            for (const shape of this.shapes) {
                if (shape.options.has("skipDraw") && shape.options.get("skipDraw")) continue;
                if (shape.labels.length === 0 && gameStore.filterNoLabel) continue;
                if (
                    shape.labels.length &&
                    gameStore.labelFilters.length &&
                    !shape.labels.some(l => gameStore.labelFilters.includes(l.uuid))
                )
                    continue;
                if (layerManager.getLayer(this.floor) === undefined) continue;
                if (!shape.visibleInCanvas(this.canvas)) continue;
                if (this.name === "fow" && layerManager.getLayer(this.floor)!.name !== this.name) continue;
                shape.draw(ctx);
            }

            if (this.selection != null) {
                ctx.fillStyle = this.selectionColor;
                ctx.strokeStyle = this.selectionColor;
                ctx.lineWidth = this.selectionWidth;
                for (const shape of this.selection) {
                    shape.drawSelection(ctx);
                }
            }

            // If this is the last layer of the floor below, render some shadow
            if (gameStore.selectedFloorIndex > 0) {
                const lowerFloor = layerManager.floors[gameStore.selectedFloorIndex - 1];
                if (lowerFloor.name === this.floor) {
                    if (lowerFloor.layers[lowerFloor.layers.length - 1].name === this.name) {
                        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
                        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                    }
                }
            }

            ctx.globalCompositeOperation = ogOP;
            this.valid = true;
            this.resolveCallbacks();
        }
    }

    waitValid(): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.postDrawCallbacks.push(resolve);
        });
    }

    private resolveCallbacks(): void {
        for (const cb of this.postDrawCallbacks) cb();
        this.postDrawCallbacks = [];
    }

    moveShapeOrder(shape: Shape, destinationIndex: number, sync: boolean): void {
        const oldIdx = this.shapes.indexOf(shape);
        if (oldIdx === destinationIndex) return;
        this.shapes.splice(oldIdx, 1);
        this.shapes.splice(destinationIndex, 0, shape);
        if (sync) socket.emit("Shape.Order.Set", { shape: shape.asDict(), index: destinationIndex });
        this.invalidate(true);
    }

    updateShapePoints(shape: Shape): void {
        for (const point of this.points) {
            if (point[1].has(shape.uuid)) {
                if (point[1].size === 1) this.points.delete(point[0]);
                else point[1].delete(shape.uuid);
            }
        }
        for (const point of shape.points) {
            const strp = JSON.stringify(point);
            if (this.points.has(strp) && !this.points.get(strp)!.has(shape.uuid))
                this.points.get(strp)!.add(shape.uuid);
            else if (!this.points.has(strp)) this.points.set(strp, new Set([shape.uuid]));
        }
    }
}
