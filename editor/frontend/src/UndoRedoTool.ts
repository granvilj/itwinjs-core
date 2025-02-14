/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import { IModelApp, IpcApp, Tool } from "@itwin/core-frontend";

/** @alpha Undo all element changes */
export class UndoAllTool extends Tool {
  public static override toolId = "UndoAll";
  public override async run(): Promise<boolean> {
    const imodel = IModelApp.viewManager.selectedView?.view.iModel;
    if (undefined === imodel || imodel.isReadonly || !imodel.isBriefcaseConnection)
      return true;

    await IpcApp.callIpcHost("reverseAllTxn", imodel.key);

    // ### TODO Restart of primitive tool should be handled by Txn event listener...needs to happen even if not the active tool...
    if (undefined !== IModelApp.toolAdmin.primitiveTool)
      await IModelApp.toolAdmin.primitiveTool.onRestartTool();
    return true;
  }
}

/** @alpha Undo active tool steps, or element changes */
export class UndoTool extends Tool {
  public static override toolId = "Undo";
  public override async run(): Promise<boolean> {
    await IModelApp.toolAdmin.doUndoOperation();
    return true;
  }
}

/** @alpha Redo active tool steps, or element changes */
export class RedoTool extends Tool {
  public static override toolId = "Redo";
  public override async run(): Promise<boolean> {
    await IModelApp.toolAdmin.doRedoOperation();
    return true;
  }
}

