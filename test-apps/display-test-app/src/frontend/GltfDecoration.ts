/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import { Transform } from "@itwin/core-geometry";
import {
  DecorateContext, GraphicBranch, GraphicType, IModelApp, readGltfGraphics, RenderGraphic, Tool,
} from "@itwin/core-frontend";

class GltfDecoration {
  private readonly _graphic: RenderGraphic;
  private readonly _tooltip: string;
  private readonly _pickableId?: string;

  public constructor(graphic: RenderGraphic, tooltip: string, pickableId?: string) {
    this._graphic = graphic;
    this._tooltip = tooltip;
    this._pickableId = pickableId;
  }

  public readonly useCachedDecorations = true;

  public decorate(context: DecorateContext): void {
    if (context.viewport.view.isSpatialView())
      context.addDecoration(GraphicType.Scene, this._graphic);
  }

  public testDecorationHit(id: string): boolean {
    return undefined !== this._pickableId && id === this._pickableId;
  }

  public async getDecorationToolTip() {
    return this._tooltip;
  }
}

/** Opens a file picker from which the user can select a glTF or glb file. Creates a decoration graphic from the glTF and
 * installs a decorator to display it at the center of the active viewport's iModel's project extents.
 */
export class GltfDecorationTool extends Tool {
  public static override toolId = "AddGltfDecoration";
  public static override get minArgs() { return 1; }
  public static override get maxArgs() { return 1; }

  public override async parseAndRun(...args: string[]) {
    return this.run(args[0]);
  }

  public override async run(url?: string) {
    if ("string" !== typeof url)
      return false;

    const iModel = IModelApp.viewManager.selectedView?.iModel;
    if (!iModel)
      return false;

    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();

      // Convert the glTF into a RenderGraphic.
      const id = iModel.transientIds.next;
      let graphic = await readGltfGraphics({
        gltf: new Uint8Array(buffer),
        iModel,
        baseUrl: url,
        pickableOptions: {
          id,
          // The modelId must be different from the pickable Id for the decoration to be selectable and hilite-able.
          modelId: iModel.transientIds.next,
        },
      });

      if (!graphic)
        return false;

      // Transform the graphic to the center of the project extents.
      const branch = new GraphicBranch();
      branch.add(graphic);
      const transform = Transform.createTranslation(iModel.projectExtents.center);
      graphic = IModelApp.renderSystem.createGraphicBranch(branch, transform);

      // Take ownership of the graphic so it is not disposed of until we're finished with it.
      const graphicOwner = IModelApp.renderSystem.createGraphicOwner(graphic);

      // Install the decorator.
      const decorator = new GltfDecoration(graphicOwner, url, id);
      IModelApp.viewManager.addDecorator(decorator);

      // Once the iModel is closed, dispose of the graphic and uninstall the decorator.
      iModel.onClose.addOnce(() => {
        graphicOwner.disposeGraphic();
        IModelApp.viewManager.dropDecorator(decorator);
      });

      return true;
    } catch (_) {
      return false;
    }
  }
}
