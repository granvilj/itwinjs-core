/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2018 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
/** @module WireFormats */

/**
 * Metadata about a thumbnail. Often this is redundant with information in the image itself, but is held
 * outside of the image so it can be obtained without having to decode the image data.
 */
export interface ThumbnailFormatProps {
  /** X size of the image */
  width: number;
  /** Y size of image */
  height: number;
  /** Format of the image */
  format: "jpeg" | "png";
}

/** Properties of a thumbnail in an iModel. */
export interface ThumbnailProps extends ThumbnailFormatProps {
  /** Image data */
  image: Uint8Array;
}
