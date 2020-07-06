/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
/** @packageDocumentation
 * @module Color
 */

import "./Swatch.scss";
import classnames from "classnames";
import * as React from "react";
import { ColorDef } from "@bentley/imodeljs-common";
import { CommonProps } from "@bentley/ui-core";

/** Properties for the [[ColorSwatch]] React component
 * @beta
 */
export interface ColorSwatchProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, CommonProps {
  /** color specification */
  colorDef: ColorDef;
  /** function to run when user selects color swatch */
  onColorPick?: ((color: ColorDef, e: React.MouseEvent) => void) | undefined;
  /** Show swatches as squares unless round is set to true */
  round?: boolean;
}

/** ColorSwatch Functional component displays a color swatch in a button
 * @beta
 */
export function ColorSwatch(props: ColorSwatchProps) {
  const { b, g, r, t } = props.colorDef.colors as any;

  const rgbaString = `rgb(${r},${g},${b},${(255 - t) / 255})`;
  const colorStyle: React.CSSProperties = {
    backgroundColor: rgbaString,
    ...props.style,
  };

  const handleClick = (e: React.MouseEvent) => {
    // istanbul ignore else
    if (props && props.onColorPick)
      props.onColorPick(props.colorDef, e);
  };

  const classes = classnames(
    "components-color-swatch",
    props.round && "round",
    props.className,
  );

  const {
    onColorPick, colorDef, round, // do not pass on color swatch specific props
    ...otherProps /* tslint:disable-line: trailing-comma */ // pass-through props
  } = props as any;

  return <button {...otherProps} style={colorStyle} className={classes} onClick={handleClick} />;
}
