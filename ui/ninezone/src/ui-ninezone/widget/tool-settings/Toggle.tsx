/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module ToolSettings */

import * as classnames from "classnames";
import * as React from "react";
import { CommonProps } from "@bentley/ui-core";
import { TrianglePopover } from "../../popup/popover/Triangle";
import { Direction } from "../../utilities/Direction";
import { NoChildrenProps } from "../../utilities/Props";
import "./Toggle.scss";

/** Properties of [[Toggle]] component.
 * @alpha
 */
export interface ToggleProps extends CommonProps, NoChildrenProps {
  /** Content of the toggle. */
  content?: React.ReactNode;
  /** Function called when the toggle is clicked. */
  onClick?: () => void;
  /** Content of the popup. */
  popupContent?: React.ReactChild;
}

/** Tool settings toggle component.
 * @note Used in [[ToolSettings]] component
 * @alpha
 */
export class Toggle extends React.PureComponent<ToggleProps> {
  public render() {
    const className = classnames(
      "nz-widget-toolSettings-toggle",
      this.props.className);

    return (
      <div
        className={className}
        style={this.props.style}
      >
        <div
          className="nz-toggle"
          onClick={this.props.onClick}
        >
          <div className="nz-content">
            {this.props.content}
          </div>
          <div className="nz-triangle" />
        </div>
        {!this.props.popupContent ? undefined :
          <TrianglePopover
            className="nz-popup"
            direction={Direction.Bottom}
            content={this.props.popupContent}
          />
        }
      </div>
    );
  }
}
