/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module StatusBar */

import * as React from "react";
import { PluginUiManager, PluginStatusBarItemsManager, StageUsage, PluginStatusbarItemsChangedArgs, CommonStatusBarItem } from "@bentley/ui-abstract";
import { useActiveStageId } from "../hooks/useActiveStageId";
import { useAvailablePluginUiProviders } from "../hooks/useAvailablePluginUiProviders";

/** Hook that returns items from [[PluginStatusBarItemsManager]].
 * @beta
 */
export const usePluginStatusBarItems = (manager: PluginStatusBarItemsManager | undefined): readonly CommonStatusBarItem[] => {
  const pluginUiProviderIds = useAvailablePluginUiProviders();
  const stageId = useActiveStageId();
  const [items, setItems] = React.useState(manager ? manager.items : []);
  const providersRef = React.useRef("");
  const currentStageRef = React.useRef("");
  // gathers items from registered plugins - dependent on when a pluginUiProvider is register or unregistered and if the
  // current stage's composer allows entries from plugins.
  React.useEffect(() => {
    if (manager) {
      const uiProviders = pluginUiProviderIds.join("-");
      if (providersRef.current !== uiProviders || currentStageRef.current !== stageId) {
        currentStageRef.current = stageId;
        providersRef.current = uiProviders;
        manager.loadItems(PluginUiManager.getStatusbarItems(stageId, StageUsage.General));
        setItems(manager.items);
      }
    } else {  // if a manager is not specified no items should be saved in state and current set of providers should be cleared
      setItems([]);
      providersRef.current = "";
    }
  }, [manager, pluginUiProviderIds, stageId]);
  // handle item changes caused by calls to UiFramework.pluginStatusBarItemsManager.setxxx
  React.useEffect(() => {
    const handleChanged = (args: PluginStatusbarItemsChangedArgs) => {
      setItems(args.items);
    };
    if (manager) {
      manager.onItemsChanged.addListener(handleChanged);
    }
    return () => {
      if (manager)
        manager.onItemsChanged.removeListener(handleChanged);
    };
  }, [manager]);
  return items;
};
