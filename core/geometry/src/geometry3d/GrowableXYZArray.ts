/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/

/** @module ArraysAndInterfaces */

import { Geometry } from "../Geometry";
import { XYAndZ } from "./XYZProps";
import { Point3d, Vector3d } from "./Point3dVector3d";
import { Range3d, Range1d } from "./Range";
import { Transform } from "./Transform";
import { Matrix3d } from "./Matrix3d";
import { IndexedXYZCollection } from "./IndexedXYZCollection";

import { Plane3dByOriginAndUnitNormal } from "./Plane3dByOriginAndUnitNormal";
import { Point2d } from "./Point2dVector2d";

/** `GrowableXYArray` manages a (possibly growing) Float64Array to pack xy coordinates.
 * @public
 */
export class GrowableXYZArray extends IndexedXYZCollection {
  /**
   * array of packed xyzxyzxyz components
   */
  private _data: Float64Array;
  /**
   * Number of xyz triples (not floats) in the array
   */
  private _xyzInUse: number;
  /**
   * capacity in xyz triples. (not floats)
   */
  private _xyzCapacity: number;
  /** Construct a new GrowablePoint3d array.
   * @param numPoints [in] initial capacity.
   */
  public constructor(numPoints: number = 8) {
    super();
    this._data = new Float64Array(numPoints * 3);   // 8 Points to start (3 values each)
    this._xyzInUse = 0;
    this._xyzCapacity = numPoints;
  }
  /** Return the number of points in use. */
  public get length() { return this._xyzInUse; }

  /** Return the number of float64 in use. */
  public get float64Length() { return this._xyzInUse * 3; }
  /** Return the raw packed data.
   * * Note that the length of the returned FLoat64Array is a count of doubles, and includes the excess capacity
   */
  public float64Data(): Float64Array { return this._data; }

  /** If necessary, increase the capacity to a new pointCount.  Current coordinates and point count (length) are unchnaged. */
  public ensureCapacity(pointCapacity: number) {
    if (pointCapacity > this._xyzCapacity) {
      const newData = new Float64Array(pointCapacity * 3);
      const numCopy = this.length * 3;
      for (let i = 0; i < numCopy; i++) newData[i] = this._data[i];
      this._data = newData;
      this._xyzCapacity = pointCapacity;
    }
  }
  /** Resize the actual point count, preserving excess capacity. */
  public resize(pointCount: number) {
    if (pointCount < this.length) {
      this._xyzInUse = pointCount >= 0 ? pointCount : 0;
    } else if (pointCount > this._xyzCapacity) {
      const newArray = new Float64Array(pointCount * 3);
      // Copy contents
      for (let i = 0; i < this._data.length; i += 3) {
        newArray[i] = this._data[i];
        newArray[i + 1] = this._data[i + 1];
        newArray[i + 2] = this._data[i + 2];
      }
      this._data = newArray;
      this._xyzCapacity = pointCount;
      this._xyzInUse = pointCount;
    }
  }
  /**
   * Make a copy of the (active) points in this array.
   * (The clone does NOT get excess capacity)
   */
  public clone(result?: GrowableXYZArray): GrowableXYZArray {
    const numValue = this.length * 3;
    if (!result)
      result = new GrowableXYZArray(this.length);
    else {
      result.clear();
      result.ensureCapacity(this.length);
    }
    const newData = result._data;
    const data = this._data;
    for (let i = 0; i < numValue; i++) newData[i] = data[i];
    result._xyzInUse = this.length;
    return result;
  }
  /** Copy point coordinates from data to a growable array.
   * @param data source points.
   * @param result optional pre-allocated GrowableXYZArray to clear and fill.
   */
  public static create(data: XYAndZ[], result?: GrowableXYZArray): GrowableXYZArray {
    if (result)
      result.clear();
    else
      result = new GrowableXYZArray(data.length);
    for (const p of data) result.push(p);
    return result;
  }

  /** push a point to the end of the array */
  public push(toPush: XYAndZ) {
    this.pushXYZ(toPush.x, toPush.y, toPush.z);
  }

  /** push all points of an array */
  public pushAll(points: Point3d[]) {
    for (const p of points) this.push(p);
  }
  /** Push points from variant sources.
   * Valid inputs are:
   * * Point2d
   * * point3d
   * * An array of 2 doubles
   * * An array of 3 doubles
   * * A GrowableXYZArray
   * * Any json object satisfying Point3d.isXYAndZ
   * * Any json object satisfying Point3d.isXAndY
   * * An array of any of the above
   * @returns the number of points added.
   */
  public pushFrom(p: any) {
    if (p instanceof Point3d)
      this.pushXYZ(p.x, p.y, p.z);
    else if (p instanceof GrowableXYZArray)
      this.pushFromGrowableXYZArray(p);
    else if (p instanceof Point2d)
      this.pushXYZ(p.x, p.y, 0.0);
    else if (Geometry.isNumberArray(p, 3))
      this.pushXYZ(p[0], p[1], p[2]);
    else if (Geometry.isNumberArray(p, 2))
      this.pushXYZ(p[0], p[1], 0.0);
    else if (Array.isArray(p)) {
      // diret recursion re-wraps p and goes infinite.  unroll here .
      for (const q of p)
        this.pushFrom(q);
    } else if (Point3d.isXYAndZ(p))
      this.pushXYZ(p.x, p.y, p.z);
    else if (Point3d.isXAndY(p))
      this.pushXYZ(p.x, p.y, 0.0);
  }

  /**
   * Replicate numWrap xyz values from the front of the array as new values at the end.
   * @param numWrap number of xyz values to replicate
   */
  public pushWrap(numWrap: number) {
    if (this._xyzInUse > 0) {
      let k;
      for (let i = 0; i < numWrap; i++) {
        k = 3 * i;
        this.pushXYZ(this._data[k], this._data[k + 1], this._data[k + 2]);
      }
    }
  }
  /** append a new point with given x,y,z */
  public pushXYZ(x: number, y: number, z: number) {
    const index = this._xyzInUse * 3;
    if (index >= this._data.length)
      this.ensureCapacity(this.length * 2);
    this._data[index] = x;
    this._data[index + 1] = y;
    this._data[index + 2] = z;
    this._xyzInUse++;
  }

  /** Remove one point from the back.
   * * NOTE that (in the manner of std::vector native) this is "just" removing the point -- no point is NOT returned.
   * * Use `back ()` to get the last x,y,z assembled into a `Point3d `
   */
  public pop() {
    if (this._xyzInUse > 0)
      this._xyzInUse--;
  }
  /**
   * Test if index is valid for an xyz (point or vector) withibn this array
   * @param index xyz index to test.
   */
  public isIndexValid(index: number): boolean {
    if (index >= this._xyzInUse || index < 0)
      return false;
    return true;
  }
  /**
   * Clear all xyz data, but leave capacity unchanged.
   */
  public clear() {
    this._xyzInUse = 0;
  }
  /**
   * Get a point by index, strongly typed as a Point3d.  This is unchecked.  Use getPoint3dAtCheckedPointIndex to have validity test.
   * @param pointIndex index to access
   * @param result optional result
   */
  public getPoint3dAtUncheckedPointIndex(pointIndex: number, result?: Point3d): Point3d {
    const index = 3 * pointIndex;
    return Point3d.create(this._data[index], this._data[index + 1], this._data[index + 2], result);
  }

  /**
   * Get a point by index, strongly typed as a Point2d.  This is unchecked.  Use getPoint2dAtCheckedPointIndex to have validity test.
   * @param pointIndex index to access
   * @param result optional result
   */
  public getPoint2dAtUncheckedPointIndex(pointIndex: number, result?: Point2d): Point2d {
    const index = 3 * pointIndex;
    return Point2d.create(this._data[index], this._data[index + 1], result);
  }

  /** copy xyz into strongly typed Point3d */
  public getPoint3dAtCheckedPointIndex(pointIndex: number, result?: Point3d): Point3d | undefined {
    const index = 3 * pointIndex;
    if (this.isIndexValid(pointIndex)) {
      if (!result) result = Point3d.create();
      result.x = this._data[index];
      result.y = this._data[index + 1];
      result.z = this._data[index + 2];
      return result;
    }
    return undefined;
  }

  /** copy xy into strongly typed Point2d */
  public getPoint2dAtCheckedPointIndex(pointIndex: number, result?: Point2d): Point2d | undefined {
    const index = 3 * pointIndex;
    if (this.isIndexValid(pointIndex)) {
      if (!result) result = Point2d.create();
      result.x = this._data[index];
      result.y = this._data[index + 1];
      return result;
    }
    return undefined;
  }
  /** copy xyz into strongly typed Vector3d */
  public getVector3dAtCheckedVectorIndex(vectorIndex: number, result?: Vector3d): Vector3d | undefined {
    const index = 3 * vectorIndex;
    if (vectorIndex >= 0 && vectorIndex < this._xyzInUse) {
      if (!result) result = Vector3d.create();
      result.x = this._data[index];
      result.y = this._data[index + 1];
      result.z = this._data[index + 2];
      return result;
    }
    return undefined;
  }

  /**
   * Read coordinates from source array, place them at indexe within this array.
   * @param destIndex point index where coordinats are to be placed in this array
   * @param source source array
   * @param sourceIndex point index in source array
   * @returns true if destIndex and sourceIndex are both valid.
   */
  public transferFromGrowableXYZArray(destIndex: number, source: GrowableXYZArray, sourceIndex: number): boolean {
    if (this.isIndexValid(destIndex) && source.isIndexValid(sourceIndex)) {
      const i = destIndex * 3;
      const j = sourceIndex * 3;
      this._data[i] = source._data[j];
      this._data[i + 1] = source._data[j + 1];
      this._data[i + 2] = source._data[j + 2];
      return true;
    }
    return false;
  }

  /**
   * push coordinates from the source array to the end of this array.
   * @param source source array
   * @param sourceIndex xyz index within the source.  If undefined, entire source is pushed.
   * @returns number of points pushed.
   */
  public pushFromGrowableXYZArray(source: GrowableXYZArray, sourceIndex?: number): number {
    // full array push  . . .
    if (sourceIndex === undefined) {
      const numXYZAdd = source.length;
      this.ensureCapacity(this.length + numXYZAdd);
      const nXAdd = source.length * 3;
      const i0 = this._xyzInUse * 3;
      for (let i = 0; i < nXAdd; i++)
        this._data[i0 + i] = source._data[i];
      this._xyzInUse += numXYZAdd;
      return numXYZAdd;
    }
    // single point push . . .
    if (source.isIndexValid(sourceIndex)) {
      const j = sourceIndex * 3;
      this.pushXYZ(source._data[j], source._data[j + 1], source._data[j + 2]);
      return 1;
    }
    return 0;
  }

  /**
   * Return the first point, or undefined if the array is empty.
   */
  public front(result?: Point3d): Point3d | undefined {
    if (this._xyzInUse === 0) return undefined;
    return this.getPoint3dAtUncheckedPointIndex(0, result);
  }
  /**
   * Return the last point, or undefined if the array is empty.
   */
  public back(result?: Point3d): Point3d | undefined {
    if (this._xyzInUse < 1) return undefined;
    return this.getPoint3dAtUncheckedPointIndex(this._xyzInUse - 1, result);
  }
  /**
   * Set the coordinates of a single point.
   * @param pointIndex index of point to set
   * @param value coordinates to set
   */
  public setAtCheckedPointIndex(pointIndex: number, value: XYAndZ): boolean {
    if (!this.isIndexValid(pointIndex))
      return false;
    let index = pointIndex * 3;
    this._data[index++] = value.x;
    this._data[index++] = value.y;
    this._data[index] = value.z;
    return true;
  }
  /**
   * Set the coordinates of a single point given as coordintes
   * @param pointIndex index of point to set
   * @param x x coordinate
   * @param y y coordinate
   * @param z z coordinate
   */
  public setXYZAtCheckedPointIndex(pointIndex: number, x: number, y: number, z: number): boolean {
    if (!this.isIndexValid(pointIndex))
      return false;
    let index = pointIndex * 3;
    this._data[index++] = x;
    this._data[index++] = y;
    this._data[index] = z;
    return true;
  }

  /**
   * Copy all points into a simple array of Point3d
   */
  public getPoint3dArray(): Point3d[] {
    const result = [];
    const data = this._data;
    const n = this.length;
    for (let i = 0; i < n; i++) {
      result.push(Point3d.create(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
    }
    return result;
  }
  /** multiply each point by the transform, replace values. */
  public multiplyTransformInPlace(transform: Transform) {
    const data = this._data;
    const nDouble = this.float64Length;
    const coffs = transform.matrix.coffs;
    const origin = transform.origin;
    const x0 = origin.x;
    const y0 = origin.y;
    const z0 = origin.z;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i + 2 <= nDouble; i += 3) {
      x = data[i];
      y = data[i + 1];
      z = data[i + 2];
      data[i] = coffs[0] * x + coffs[1] * y + coffs[2] * z + x0;
      data[i + 1] = coffs[3] * x + coffs[4] * y + coffs[5] * z + y0;
      data[i + 2] = coffs[6] * x + coffs[7] * y + coffs[8] * z + z0;
    }
  }

  /** multiply each xyz (as a vector) by matrix, replace values. */
  public multiplyMatrix3dInPlace(matrix: Matrix3d) {
    const data = this._data;
    const nDouble = this.float64Length;
    const coffs = matrix.coffs;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i + 2 <= nDouble; i += 3) {
      x = data[i];
      y = data[i + 1];
      z = data[i + 2];
      data[i] = coffs[0] * x + coffs[1] * y + coffs[2] * z;
      data[i + 1] = coffs[3] * x + coffs[4] * y + coffs[5] * z;
      data[i + 2] = coffs[6] * x + coffs[7] * y + coffs[8] * z;
    }
  }

  /** multiply each xyz (as a vector) by matrix inverse transpse, renormalize the vector, replace values.
   * * This is the way to apply a matrix (possibly with skew and scale) to a surface normal, and
   *      have it end up perpendicular to the transformed in-surface vectors.
   * * Return false if matrix is not invertible or if any normalization fails.
   */
  public multiplyAndRenormalizeMatrix3dInverseTransposeInPlace(matrix: Matrix3d): boolean {
    const data = this._data;
    const nDouble = this.float64Length;
    if (!matrix.computeCachedInverse(true))
      return false;
    const coffs = matrix.inverseCoffs!;
    const tol = 1.0e-15;
    let x = 0;
    let y = 0;
    let z = 0;
    let x1;
    let y1;
    let z1;
    let q;
    let a;
    let numFail = 0;
    for (let i = 0; i + 2 <= nDouble; i += 3) {
      x = data[i];
      y = data[i + 1];
      z = data[i + 2];
      x1 = coffs[0] * x + coffs[3] * y + coffs[6] * z;
      y1 = coffs[1] * x + coffs[4] * y + coffs[7] * z;
      z1 = coffs[2] * x + coffs[5] * y + coffs[8] * z;
      a = x1 * x1 + y1 * y1 + z1 * z1;
      if (a < tol) {
        // put the originals back ..
        x1 = x; y1 = y; z1 = z;
        numFail++;
      } else if (Math.abs(a - 1.0) > tol) {
        q = 1.0 / Math.sqrt(a);
        x1 *= q;
        y1 *= q;
        z1 *= q;
      } // else -- q is near 1, no need to do the division !!
      data[i] = x1;
      data[i + 1] = y1;
      data[i + 2] = z1;
    }
    return numFail === 0;
  }

  /** multiply each point by the transform, replace values. */
  public tryTransformInverseInPlace(transform: Transform): boolean {
    const data = this._data;
    const nDouble = this.float64Length;
    const matrix = transform.matrix;
    matrix.computeCachedInverse(true);
    const coffs = matrix.inverseCoffs;
    if (!coffs)
      return false;
    const origin = transform.origin;
    const x0 = origin.x;
    const y0 = origin.y;
    const z0 = origin.z;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i + 3 <= nDouble; i += 3) {
      x = data[i] - x0;
      y = data[i + 1] - y0;
      z = data[i + 2] - z0;
      data[i] = coffs[0] * x + coffs[1] * y + coffs[2] * z;
      data[i + 1] = coffs[3] * x + coffs[4] * y + coffs[5] * z;
      data[i + 2] = coffs[6] * x + coffs[7] * y + coffs[8] * z;
    }
    return true;
  }
  /** Extend `range` to extend by all points. */
  public extendRange(rangeToExtend: Range3d, transform?: Transform) {
    const numDouble = this.float64Length;
    const data = this._data;
    if (transform) {
      for (let i = 0; i + 3 <= numDouble; i += 3)
        rangeToExtend.extendTransformedXYZ(transform, data[i], data[i + 1], data[i + 2]);
    } else {
      for (let i = 0; i + 3 <= numDouble; i += 3)
        rangeToExtend.extendXYZ(data[i], data[i + 1], data[i + 2]);

    }
  }
  /** Sum the lengths of segments between points. */
  public sumLengths(): number {
    let sum = 0.0;
    const n = 3 * (this._xyzInUse - 1);  // Length already takes into account what specifically is in use
    const data = this._data;
    for (let i = 0; i < n; i += 3) sum += Geometry.hypotenuseXYZ(
      data[i + 3] - data[i],
      data[i + 4] - data[i + 1],
      data[i + 5] - data[i + 2]);
    return sum;
  }
  /**
   * Multiply each x,y,z by the scale factor.
   * @param factor
   */
  public scaleInPlace(factor: number) {
    if (this._data) {
      const numFloat = this.float64Length;
      for (let i = 0; i < numFloat; i++)
        this._data[i] = this._data[i] * factor;
    }
  }
  /** test if all points are within tolerance of a plane. */
  public isCloseToPlane(plane: Plane3dByOriginAndUnitNormal, tolerance: number = Geometry.smallMetricDistance): boolean {
    const numCoordinate = 3 * this._xyzInUse;
    const data = this._data;
    for (let i = 0; i < numCoordinate; i += 3)
      if (Math.abs(plane.altitudeXYZ(data[i], data[i + 1], data[i + 2])) > tolerance)
        return false;
    return true;
  }
  /** Compute a point at fractional coordinate between points i and j */
  public interpolate(i: number, fraction: number, j: number, result?: Point3d): Point3d | undefined {
    if (this.isIndexValid(i) && this.isIndexValid(j)) {
      const fraction0 = 1.0 - fraction;
      const data = this._data;
      i = 3 * i;
      j = 3 * j;
      return Point3d.create(
        fraction0 * data[i] + fraction * data[j],
        fraction0 * data[i + 1] + fraction * data[j + 1],
        fraction0 * data[i + 2] + fraction * data[j + 2], result);
    }
    return undefined;
  }

  /**
   * * Compute a point at fractional coordinate between points i and j of source
   * * push onto this array.
   */
  public pushInterpolatedFromGrowableXYZArray(source: GrowableXYZArray, i: number, fraction: number, j: number) {
    if (source.isIndexValid(i) && source.isIndexValid(j)) {
      const fraction0 = 1.0 - fraction;
      const data = source._data;
      i = 3 * i;
      j = 3 * j;
      this.pushXYZ(
        fraction0 * data[i] + fraction * data[j],
        fraction0 * data[i + 1] + fraction * data[j + 1],
        fraction0 * data[i + 2] + fraction * data[j + 2]);
    }
  }

  /** Sum the signed areas of the projection to xy plane */
  public areaXY(): number {
    let area = 0.0;
    const n = 3 * this._xyzInUse;    // float count !!
    if (n > 6) {
      const x0 = this._data[n - 3];
      const y0 = this._data[n - 2];
      let dx1 = this._data[0] - x0;
      let dy1 = this._data[1] - y0;
      let dx2 = 0;
      let dy2 = 0;
      for (let i = 3; i < n; i += 3, dx1 = dx2, dy1 = dy2) {
        dx2 = this._data[i] - x0;
        dy2 = this._data[i + 1] - y0;
        area += Geometry.crossProductXYXY(dx1, dy1, dx2, dy2);
      }
    }
    return 0.5 * area;
  }

  /** Compute a vector from index origin i to indexed target j  */
  public vectorIndexIndex(i: number, j: number, result?: Vector3d): Vector3d | undefined {
    if (!this.isIndexValid(i) || !this.isIndexValid(j))
      return undefined;
    if (!result) result = Vector3d.create();
    const data = this._data;
    i = 3 * i;
    j = 3 * j;
    result.x = data[j] - data[i];
    result.y = data[j + 1] - data[i + 1];
    result.z = data[j + 2] - data[i + 2];
    return result;
  }

  /** Compute a vector from origin to indexed target j */
  public vectorXYAndZIndex(origin: XYAndZ, j: number, result?: Vector3d): Vector3d | undefined {
    if (this.isIndexValid(j)) {
      const data = this._data;
      j = 3 * j;
      return Vector3d.create(
        data[j] - origin.x,
        data[j + 1] - origin.y,
        data[j + 2] - origin.z, result);
    }
    return undefined;
  }

  /** Compute the cross product of vectors from from indexed origin to indexed targets i and j */
  public crossProductIndexIndexIndex(originIndex: number, targetAIndex: number, targetBIndex: number, result?: Vector3d): Vector3d | undefined {
    const i = originIndex * 3;
    const j = targetAIndex * 3;
    const k = targetBIndex * 3;
    const data = this._data;
    if (this.isIndexValid(originIndex) && this.isIndexValid(targetAIndex) && this.isIndexValid(targetBIndex))
      return Geometry.crossProductXYZXYZ(
        data[j] - data[i], data[j + 1] - data[i + 1], data[j + 2] - data[i + 2],
        data[k] - data[i], data[k + 1] - data[i + 1], data[k + 2] - data[i + 2],
        result);
    return undefined;
  }

  /** Compute the dot product of pointIndex with [x,y,z] */
  public evaluateUncheckedIndexDotProductXYZ(pointIndex: number, x: number, y: number, z: number): number {
    const i = pointIndex * 3;
    const data = this._data;
    return data[i] * x + data[i + 1] * y + data[i + 2] * z;
  }

  /**
   * * compute the cross product from indexed origin t indexed targets targetAIndex and targetB index.
   * * accumulate it to the result.
   */
  public accumulateCrossProductIndexIndexIndex(originIndex: number, targetAIndex: number, targetBIndex: number, result: Vector3d): void {
    const i = originIndex * 3;
    const j = targetAIndex * 3;
    const k = targetBIndex * 3;
    const data = this._data;
    if (this.isIndexValid(originIndex) && this.isIndexValid(targetAIndex) && this.isIndexValid(targetBIndex))
      result.addCrossProductToTargetsInPlace(
        data[i], data[i + 1], data[i + 2],
        data[j], data[j + 1], data[j + 2],
        data[k], data[k + 1], data[k + 2]);
    return undefined;
  }

  /** Compute the cross product of vectors from from origin to indexed targets i and j */
  public crossProductXYAndZIndexIndex(origin: XYAndZ, targetAIndex: number, targetBIndex: number, result?: Vector3d): Vector3d | undefined {
    const j = targetAIndex * 3;
    const k = targetBIndex * 3;
    const data = this._data;
    if (this.isIndexValid(targetAIndex) && this.isIndexValid(targetBIndex))
      return Geometry.crossProductXYZXYZ(
        data[j] - origin.x, data[j + 1] - origin.y, data[j + 2] - origin.z,
        data[k] - origin.x, data[k + 1] - origin.y, data[k + 2] - origin.z,
        result);
    return undefined;
  }

  /** Return the distance between two points in the array. */
  public distance(i: number, j: number): number | undefined {
    if (i >= 0 && i < this._xyzInUse && j >= 0 && j <= this._xyzInUse) {
      const i0 = 3 * i;
      const j0 = 3 * j;
      return Geometry.hypotenuseXYZ(
        this._data[j0] - this._data[i0],
        this._data[j0 + 1] - this._data[i0 + 1],
        this._data[j0 + 2] - this._data[i0 + 2]);
    }
    return undefined;
  }
  /** Return the distance between an array point and the input point. */
  public distanceIndexToPoint(i: number, spacePoint: XYAndZ): number | undefined {
    if (i >= 0 && i < this._xyzInUse) {
      const i0 = 3 * i;
      return Geometry.hypotenuseXYZ(
        spacePoint.x - this._data[i0],
        spacePoint.y - this._data[i0 + 1],
        spacePoint.z - this._data[i0 + 2]);
    }
    return undefined;
  }

  /** Return the distance between points in distinct arrays. */
  public static distanceBetweenPointsIn2Arrays(arrayA: GrowableXYZArray, i: number, arrayB: GrowableXYZArray, j: number): number | undefined {

    if (i >= 0 && i < arrayA._xyzInUse && j >= 0 && j <= arrayB._xyzInUse) {
      const i0 = 3 * i;
      const j0 = 3 * j;
      return Geometry.hypotenuseXYZ(
        arrayB._data[j0] - arrayA._data[i0],
        arrayB._data[j0 + 1] - arrayA._data[i0 + 1],
        arrayB._data[j0 + 2] - arrayA._data[i0 + 2]);
    }
    return undefined;
  }
/** test for near equality between two `GrowableXYZArray`. */
  public static isAlmostEqual(dataA: GrowableXYZArray | undefined, dataB: GrowableXYZArray | undefined): boolean {
    if (dataA && dataB) {
      if (dataA.length !== dataB.length)
        return false;
      for (let i = 0; i < dataA.length; i++)
        if (!dataA.getPoint3dAtUncheckedPointIndex(i).isAlmostEqual(dataB.getPoint3dAtUncheckedPointIndex(i)))
          return false;
      return true;
    }
    // if both are null it is equal, otherwise unequal
    return (!dataA && !dataB);
  }

  /** Return an array of block indices sorted per compareLexicalBlock function */
  public sortIndicesLexical(): Uint32Array {
    const n = this._xyzInUse;
    // let numCompare = 0;
    const result = new Uint32Array(n);
    for (let i = 0; i < n; i++)result[i] = i;
    result.sort(
      (blockIndexA: number, blockIndexB: number) => {
        // numCompare++;
        return this.compareLexicalBlock(blockIndexA, blockIndexB);
      });
    // console.log (n, numCompare);
    return result;
  }

  /** compare two blocks in simple lexical order. */
  public compareLexicalBlock(ia: number, ib: number): number {
    let ax = 0;
    let bx = 0;
    for (let i = 0; i < 3; i++) {
      ax = this._data[ia * 3 + i];
      bx = this._data[ib * 3 + i];
      if (ax > bx) return 1;
      if (ax < bx) return -1;
    }
    return ia - ib; // so original order is maintained among duplicates !!!!
  }

  /** Access a single double at offset within a block.  This has no index checking. */
  public component(pointIndex: number, componentIndex: number): number {
    return this._data[3 * pointIndex + componentIndex];
  }
  /**
   * add points at regular steps from `other`
   * @param source
   * @param pointIndex0
   * @param step
   * @param numAdd
   */
  public addSteppedPoints(other: GrowableXYZArray, pointIndex0: number, step: number, numAdd: number) {
    const dataB = other._data;
    let b0 = pointIndex0 * 3;
    const nb = other.length * 3;
    let numAdded = 0;
    while (b0 >= 0 && b0 + 2 < nb && numAdded < numAdd) {
      this.pushXYZ(dataB[b0], dataB[b0 + 1], dataB[b0 + 2]);
      b0 += step * 3;
      numAdded++;
    }
  }

  /**
   * find the min and max distance between corresponding indexed points.   Excess points are ignored.
   * @param arrayA first array
   * @param arrayB second array
   */
  public static distanceRangeBetweenCorrespondingPoints(arrayA: GrowableXYZArray, arrayB: GrowableXYZArray): Range1d {
    const dataA = arrayA._data;
    const dataB = arrayB._data;
    const n = Math.min(arrayA.length, arrayB.length);
    let i = 0;
    let k0;
    const range = Range1d.createNull();
    while (i < n) {
      k0 = 3 * i;
      range.extendX(Geometry.hypotenuseXYZ(dataA[k0] - dataB[k0], dataA[k0 + 1] - dataB[k0 + 1], dataA[k0 + 2] - dataB[k0 + 2]));
      i++;
    }
    return range;
  }

}
