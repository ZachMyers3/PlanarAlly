import gameManager from "../planarally";
import { vm } from "../planarally";
import { Vector } from "../geom";
import Settings from "../settings";
import { sendClientOptions, socket } from "../socket";
import { calculateDelta } from "../ui/tools/utils";
import store from "../store";

function targetIsInput(e: Event) {
    if (e.target && (<HTMLElement>e.target).tagName)
        return ["INPUT", "TEXTAREA"].includes((<HTMLElement>e.target).tagName);
    return false;
}

export function onKeyUp (event: KeyboardEvent) {
    if ((event.key == "Delete" || event.key == 'Del') && !targetIsInput(event)) {
        if (gameManager.layerManager.getLayer === undefined) {
            console.log("No active layer selected for delete operation");
            return;
        }
        const l = gameManager.layerManager.getLayer()!;
        for(let i=l.selection.length - 1; i >= 0; i--) {
            const sel = l.selection[i];
            if ((<any>(<any>vm.$refs.tools).$refs.selectTool).selectionHelper.uuid === sel.uuid) {
                l.selection.splice(i, 1);
                continue;
            }
            l.removeShape(sel, true, false);
            (<any>vm.$refs.selectionInfo).shape = null;
            gameManager.initiativeTracker.removeInitiative(sel.uuid, true, false);
        }
    }
}

export function onKeyDown (event: KeyboardEvent) {
    // The arrow keys codes:           37: left   38: up  39: right  40:down
    if (!targetIsInput(event) && event.keyCode >= 37 && event.keyCode <= 40) {
        // todo: this should already be rounded
        const gridSize = Math.round(store.state.gridSize);
        let x_offset = gridSize * (event.keyCode % 2);
        let y_offset = gridSize * (event.keyCode % 2 ? 0 : 1);
        if (gameManager.layerManager.hasSelection()) {
            const selection = gameManager.layerManager.getSelection()!;
            x_offset *= (event.keyCode <= 38 ? -1 : 1);
            y_offset *= (event.keyCode <= 38 ? -1 : 1);
            let delta = new Vector(x_offset, y_offset);
            if (!event.shiftKey || !store.state.IS_DM) {
                // First check for collisions.  Using the smooth wall slide collision check used on mouse move is overkill here.
                for (let i=0; i<selection.length; i++) {
                    const sel = selection[i];
                    delta = calculateDelta(delta, sel);
                }
            }
            for (let i=0; i<selection.length; i++) {
                const sel = selection[i];
                sel.refPoint.x += delta.x;
                sel.refPoint.y += delta.y;
                if (sel.refPoint.x % gridSize !== 0 || sel.refPoint.y % gridSize !== 0)
                    sel.snapToGrid();
                socket.emit("shapeMove", { shape: sel.asDict(), temporary: false });
            }
            gameManager.layerManager.getLayer()!.invalidate(false);
        } else {
            // The pan offsets should be in the opposite direction to give the correct feel.
            store.commit("increasePanX", x_offset * (event.keyCode <= 38 ? 1 : -1));
            store.commit("increasePanY", y_offset * (event.keyCode <= 38 ? 1 : -1));
            gameManager.layerManager.invalidate();
            sendClientOptions();
        }
    } else if (event.keyCode == 68 && !targetIsInput(event)) {
        const layer = gameManager.layerManager.getLayer();
        if (layer) {
            layer.selection = [];
            layer.invalidate(true);
        }
    }
};