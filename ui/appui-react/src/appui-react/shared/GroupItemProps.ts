/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
/** @packageDocumentation
 * @module Item
 */

import type { StringGetter } from "@itwin/appui-abstract";
import type { Direction } from "@itwin/appui-layout-react";
import type { AnyItemDef } from "./AnyItemDef";
import type { ItemProps } from "./ItemProps";

/** Definition for a Group item that opens a group of items.
 * @public
 */
export interface GroupItemProps extends ItemProps {
  defaultActiveItemId?: string;
  groupId?: string;
  items: AnyItemDef[];
  direction?: Direction; // eslint-disable-line deprecation/deprecation
  itemsInColumn?: number;
  /** if set, it is used to explicitly set a label at top of open group component. */
  panelLabel?: string | StringGetter;
  /** if set, it is used to define a key that is used to look up a localized string. This value is used only if panelLabel is not explicitly set. */
  panelLabelKey?: string;
}
