/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
/** @module Inputs */

import * as React from "react";
import * as classnames from "classnames";
import { Slider as CompoundSlider, Handles, Rail, SliderItem, Tracks, Ticks, GetRailProps, GetTrackProps } from "react-compound-slider";

import { CommonProps } from "../utils/Props";
import { BodyText } from "../text/BodyText";

import "./Slider.scss";

// cspell:ignore pushable

/** Properties for [[Slider]] component
 * @alpha
 */
export interface SliderProps extends CommonProps {
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Values to set Slider to initially */
  values: number[];

  /** Step value. Default is 0.1. */
  step?: number;
  /** The interaction mode. Default is 1.
   * Value of 1 will allow handles to cross each other.
   * Value of 2 will keep the sliders from crossing and separated by a step.
   * Value of 3 will make the handles pushable and keep them a step apart.
   */
  mode?: number;

  /** Indicates whether the display of the Slider values is reversed. */
  reversed?: boolean;
  /** Indicates whether the Slider is disabled. */
  disabled?: boolean;
  /** Indicates whether to compensate for the tick marks when determining the width. */
  includeTicksInWidth?: boolean;

  /** Listens for value changes.
   * Triggered when the value of the slider has changed. This will receive changes at
   * the end of a slide as well as changes from clicks on rails and tracks.
   */
  onChange?: (values: ReadonlyArray<number>) => void;
  /** Listens for value updates.
   *  Called with the values at each update (caution: high-volume updates when dragging).
   */
  onUpdate?: (values: ReadonlyArray<number>) => void;
  /** Function triggered with ontouchstart or onmousedown on a handle. */
  onSlideStart?: (values: ReadonlyArray<number>) => void;
  /** Function triggered on ontouchend or onmouseup on a handle. */
  onSlideEnd?: (values: ReadonlyArray<number>) => void;

  /** Indicates whether to show tick marks under the Slider. */
  showTicks?: boolean;
  /** Indicates whether to show tick labels under the tick marks. */
  showTickLabels?: boolean;
  /** Format a tick mark value */
  formatTick?: (tick: number) => string;
  /** Function to get the tick count */
  getTickCount?: () => number;
  /** Function to get the tick values */
  getTickValues?: () => number[];

  /** Indicates whether to show min & max values to the left & right of the Slider. */
  showMinMax?: boolean;
  /** Image to show for min. */
  minImage?: React.ReactNode;
  /** Image to show for max. */
  maxImage?: React.ReactNode;

  /** Indicates whether to show tooltip with the value above the Slider. */
  showTooltip?: boolean;
  /** Format a value for the tooltip */
  formatTooltip?: (value: number) => string;
}

/**
 * Slider React component
 * @alpha
 */
// tslint:disable-next-line: variable-name
export const Slider: React.FC<SliderProps> = (props) => {
  const { className, style, min, max, values, step, mode, onChange, onUpdate,
    showTicks, showTickLabels, formatTick, getTickCount, getTickValues, includeTicksInWidth,
    reversed, disabled,
    showMinMax, minImage, maxImage,
    showTooltip, formatTooltip,
  } = props;
  const domain = [min, max];
  const multipleValues = values.length > 1;
  const containerClassNames = classnames(
    "core-slider-container",
    className,
    disabled && "disabled",
    showTickLabels && "core-slider-tickLabels",
    includeTicksInWidth && "core-slider-includeTicksInWidth",
  );
  const sliderClassNames = classnames(
    "core-slider",
    showMinMax && "core-slider-minMax",
  );

  return (
    <div className={containerClassNames} style={style}>
      {showMinMax &&
        <MinMax value={min} testId="core-slider-min" image={minImage} />
      }
      <CompoundSlider
        domain={domain}
        step={step}
        mode={mode}
        values={values}
        reversed={reversed}
        disabled={disabled}
        onChange={onChange}
        onUpdate={onUpdate}
        className={sliderClassNames}
        data-testid="core-slider"
      >
        <Rail>
          {({ getRailProps }) =>
            <Rails getRailProps={getRailProps} />
          }
        </Rail>
        <Tracks right={false} left={!multipleValues}>
          {({ tracks, activeHandleID, getEventData, getTrackProps }) => (
            <div className="slider-tracks">
              {tracks.map(({ id, source, target }) => (
                <TooltipTrack
                  key={id}
                  source={source}
                  target={target}
                  activeHandleID={activeHandleID}
                  getEventData={getEventData}
                  getTrackProps={getTrackProps}
                  showTooltip={showTooltip}
                  multipleValues={multipleValues}
                  formatTooltip={formatTooltip}
                />
              ))}
            </div>
          )}
        </Tracks>
        {showTicks &&
          <Ticks values={getTickValues && getTickValues()} count={getTickCount && getTickCount()}>
            {({ ticks }) => (
              <div className="slider-ticks" data-testid="core-slider-ticks">
                {ticks.map((tick: any, index: number) => (
                  <Tick
                    key={tick.id}
                    tick={tick}
                    count={ticks.length}
                    index={index}
                    formatTick={formatTick}
                    showTickLabels={showTickLabels}
                  />
                ))}
              </div>
            )}
          </Ticks>
        }
        <Handles>
          {({ handles, activeHandleID, getHandleProps }) => (
            <div className="slider-handles">
              {handles.map((handle: SliderItem) => (
                <Handle
                  key={handle.id}
                  domain={domain}
                  handle={handle}
                  isActive={handle.id === activeHandleID}
                  getHandleProps={getHandleProps}
                  showTooltip={showTooltip}
                  formatTooltip={formatTooltip}
                  disabled={disabled}
                />
              ))}
            </div>
          )}
        </Handles>
      </CompoundSlider>
      {showMinMax &&
        <MinMax value={max} testId="core-slider-max" image={maxImage} />
      }
    </div>
  );
};

/** Properties for [[MinMax]] component */
interface MinMaxProps {
  value: number;
  testId: string;
  image?: React.ReactNode;
}

/** MinMax component for Slider */
// tslint:disable-next-line: variable-name
const MinMax: React.FC<MinMaxProps> = (props) => {
  const { value, testId, image } = props;
  let element: React.ReactElement<any>;

  if (image)
    element = <>{image}</>;
  else
    element = <BodyText data-testid={testId}>{value}</BodyText>;

  return element;
};

/** Properties for [[Rails]] component */
interface RailsProps {
  getRailProps: GetRailProps;
}

/** Rails component for Slider */
// tslint:disable-next-line: variable-name
const Rails: React.FC<RailsProps> = (props) => {
  const { getRailProps } = props;

  return (
    <div className="core-slider-rail" {...getRailProps()}>
      <div className="core-slider-rail-inner" />
    </div>
  );
};

/** Properties for [[TooltipTrack]] component */
interface TooltipTrackProps {
  source: SliderItem;
  target: SliderItem;
  getTrackProps: GetTrackProps;
  activeHandleID: string;
  getEventData: (e: Event) => object;
  showTooltip?: boolean;
  formatTooltip?: (value: number) => string;
  multipleValues?: boolean;
}

/** State for [[TooltipTrack]] component */
interface TooltipTrackState {
  percent: number | null;
}

/** TooltipTrack component for Slider */
// tslint:disable-next-line: variable-name
const TooltipTrack: React.FC<TooltipTrackProps> = (props) => {
  const { source, target, activeHandleID, showTooltip, multipleValues, formatTooltip, getTrackProps, getEventData } = props;

  const [percent, setPercent] = React.useState(null as number | null);

  // istanbul ignore next - WIP
  const _onPointerMove = (e: React.PointerEvent) => {
    if (activeHandleID) {
      setPercent(null);
    } else {
      const state = getEventData(e.nativeEvent) as TooltipTrackState;
      setPercent(state.percent);
    }
  };

  // istanbul ignore next - WIP
  const _onPointerLeave = () => {
    setPercent(null);
  };

  let tooltipText = "";
  if (multipleValues) {
    const sourceValue = formatTooltip ? formatTooltip(source.value) : source.value.toString();
    const targetValue = formatTooltip ? formatTooltip(target.value) : target.value.toString();
    tooltipText = `${sourceValue} : ${targetValue}`;
  }

  // istanbul ignore next - WIP
  return (
    <>
      {!activeHandleID && percent && showTooltip && multipleValues ? (
        <div className="core-slider-tooltip-container" style={{ left: `${percent}%` }}>
          <div className="core-slider-tooltip" data-testid="core-slider-tooltip">
            <span className="core-slider-tooltip-text">{tooltipText}</span>
          </div>
        </div>
      ) : null}
      <div className="core-slider-track" data-testid="core-slider-track"
        style={{ left: `${source.percent}%`, width: `${target.percent - source.percent}%` }}
        onPointerMove={_onPointerMove} onPointerLeave={_onPointerLeave}
        {...getTrackProps()}
      >
        <div className="core-slider-track-inner" />
      </div>
    </>
  );
};

/** Properties for [[Tick]] component */
interface TickProps {
  tick: SliderItem;
  count: number;
  index: number;
  formatTick?: (value: number) => string;
  showTickLabels?: boolean;
}

/** Tick component for Slider */
// tslint:disable-next-line: variable-name
const Tick: React.FC<TickProps> = (props) => {
  const { tick, count, showTickLabels, formatTick } = props;
  return (
    <div>
      <div className="core-slider-tick-mark" style={{ left: `${tick.percent}%` }} />
      {showTickLabels &&
        <div className="core-slider-tick-label" style={{ marginLeft: `${-(100 / count) / 2}%`, width: `${100 / count}%`, left: `${tick.percent}%` }}>
          {formatTick !== undefined ? formatTick(tick.value) : tick.value}
        </div>
      }
    </div>
  );
};

/** Properties for [[Handle]] component */
interface HandleProps {
  key: string;
  handle: SliderItem;
  isActive: boolean;
  disabled?: boolean;
  domain: number[];
  getHandleProps: (id: string, config: object) => object;
  showTooltip?: boolean;
  formatTooltip?: (value: number) => string;
}

/** Handle component for Slider */
// tslint:disable-next-line: variable-name
const Handle: React.FC<HandleProps> = (props) => {
  const {
    domain: [min, max],
    handle: { id, value, percent },
    isActive,
    disabled,
    getHandleProps,
    showTooltip,
    formatTooltip,
  } = props;

  const [mouseOver, setMouseOver] = React.useState(false);

  // istanbul ignore next - WIP
  const _onMouseEnter = () => {
    setMouseOver(true);
  };

  // istanbul ignore next - WIP
  const _onMouseLeave = () => {
    setMouseOver(false);
  };

  // istanbul ignore next - WIP
  return (
    <>
      {(mouseOver || isActive) && !disabled && showTooltip ? (
        <div className="core-slider-tooltip-container" style={{ left: `${percent}%` }}>
          <div className="core-slider-tooltip" data-testid="core-slider-tooltip">
            <span className="core-slider-tooltip-text">{formatTooltip ? formatTooltip(value) : value}</span>
          </div>
        </div>
      ) : null}
      <div
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="core-slider-handle"
        data-testid="core-slider-handle"
        style={{ left: `${percent}%` }}
        {...getHandleProps(id, {
          onMouseEnter: _onMouseEnter,
          onMouseLeave: _onMouseLeave,
        })} >
      </div>
    </>
  );
};
