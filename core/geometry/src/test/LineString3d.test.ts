/*---------------------------------------------------------------------------------------------
* Copyright (c) 2018 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/

import { Point3d } from "../geometry3d/Point3dVector3d";
import { Transform } from "../geometry3d/Transform";
import { Matrix3d } from "../geometry3d/Matrix3d";
import { LineString3d } from "../curve/LineString3d";
import { Checker } from "./Checker";
import { expect } from "chai";
import { ClipPlane } from "../clipping/ClipPlane";
import { CurvePrimitive } from "../curve/CurvePrimitive";
import { Point2d } from "../geometry3d/Point2dVector2d";
/* tslint:disable:no-console */

function exerciseLineString3d(ck: Checker, lsA: LineString3d) {
  const expectValidResults = lsA.numPoints() > 1;
  const a = 4.2;
  const scaleTransform = Transform.createFixedPointAndMatrix(Point3d.create(4, 3),
    Matrix3d.createScale(a, a, a));
  const lsB = lsA.clone();
  lsB.reverseInPlace();
  const lsC = lsA.clone()!;
  ck.testTrue(lsC.tryTransformInPlace(scaleTransform));
  // exercise evaluation logic within each segment.
  // force evaluations in zero segment linestring
  for (let segmentIndex = 0; segmentIndex === 0 || segmentIndex + 1 < lsA.numPoints(); segmentIndex++) {
    for (const localFraction of [0.1, 0.1, 0.6, 0.6]) {
      const globalFraction = lsA.segmentIndexAndLocalFractionToGlobalFraction(segmentIndex, localFraction);
      const frame = lsA.fractionToFrenetFrame(globalFraction);
      const xyz = lsA.fractionToPoint(globalFraction);
      const ray = lsA.fractionToPointAndDerivative(globalFraction);
      const closestPointDetail = lsA.closestPoint(xyz, false);
      if (expectValidResults) {
        ck.testTrue(frame.matrix.isRigid());
        ck.testPoint3d(xyz, ray.origin);
        ck.testPoint3d(xyz, frame.getOrigin(), "frenet vs fractionToPoint", lsA, segmentIndex, localFraction, globalFraction);
        ck.testCoordinate(globalFraction, closestPointDetail.fraction);
      }
    }
  }
  const splitFraction = 0.4203;
  const partA = lsA.clonePartialCurve(0.0, splitFraction);
  const partB = lsA.clonePartialCurve(1.0, splitFraction);  // reversed to exercise more code.  But length is absolute so it will add.
  if (expectValidResults
    && ck.testPointer(partA, "forward partial") && partA
    && ck.testPointer(partA, "forward partial") && partB) {
    ck.testCoordinate(lsA.curveLength(), partA.curveLength() + partB.curveLength(), "Partial curves sum to length", lsA, partA, partB);
  }
}
describe("LineString3d", () => {
  it("HelloWorld", () => {
    const ck = new Checker();
    const ls0 = LineString3d.create();
    exerciseLineString3d(ck, ls0);
    ls0.addPoint(Point3d.create(4, 3, 2));
    exerciseLineString3d(ck, ls0);
    const point100 = Point3d.create(1, 0, 0);
    const point420 = Point3d.create(4, 2, 0);
    const point450 = Point3d.create(4, 5, 0);
    const point150 = Point3d.create(1, 5, 0);
    const lsA = LineString3d.create([point100, point420, point450, point150]);
    exerciseLineString3d(ck, lsA);
    const lsB = LineString3d.createRectangleXY(
      Point3d.create(1, 1),
      3, 2, true);
    exerciseLineString3d(ck, lsB);
    const lsC = LineString3d.create([point100]);
    ck.testUndefined(lsC.quickUnitNormal(), "quickUnitNormal expected failure 1 point");
    lsC.addPoint(point420);
    ck.testUndefined(lsC.quickUnitNormal(), "quickUnitNormal expected failure 2 point");
    lsC.addPoint(point420.interpolate(0.6, point100));
    ck.testUndefined(lsC.quickUnitNormal(), "quickUnitNormal expected failure 3 point colinear");
    const normalA = lsA.quickUnitNormal();
    if (ck.testPointer(normalA, "quickUnitNormal") && normalA)
      ck.testCoordinate(1.0, normalA.magnitude(), "unit normal magnitude");

    ck.checkpoint("LineString3d.HelloWorld");
    expect(ck.getNumErrors()).equals(0);
  });

  it("createXY", () => {
    const ck = new Checker();
    const ls = LineString3d.createXY(
      [Point2d.create(1, 1),
      Point2d.create(4, 1),
      Point2d.create(4, 2),
      Point2d.create(0, 2)],
      10.0);
    ck.testExactNumber(4, ls.numPoints());
    expect(ck.getNumErrors()).equals(0);
  });

  it("RegularPolygon", () => {
    const ck = new Checker();
    const center = Point3d.create(3, 2, 1);
    const radius = 2.0;
    const poly1 = LineString3d.createRegularPolygonXY(center, 2, radius, true);
    const poly4 = LineString3d.createRegularPolygonXY(center, 4, radius, true);
    const poly4F = LineString3d.createRegularPolygonXY(center, 4, radius, false);
    ck.testUndefined(poly1.getIndexedSegment(5));
    ck.testFalse(poly4.isAlmostEqual(poly1));
    for (let i = 0; i < 4; i++) {
      ck.testCoordinate(radius, center.distance(poly4.pointAt(i)!)); // TRUE poly has points on the radius
      ck.testLE(radius, center.distance(poly4F.pointAt(i)!)); // FALSE poly has points outside the radius
      // const segment = poly4.getIndexedSegment(i);
      const segmentF = poly4F.getIndexedSegment(i)!;
      const detail = segmentF.closestPoint(center, false);
      ck.testCoordinate(0.5, detail.fraction);
      ck.testCoordinate(radius, center.distance(detail.point));
    }
    const data64 = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const polyF64 = LineString3d.createFloat64Array(data64);
    ck.testExactNumber(3 * polyF64.numPoints(), data64.length);
    expect(ck.getNumErrors()).equals(0);
  });
  it("AnnounceClipIntervals", () => {
    const ck = new Checker();
    const ls = LineString3d.create(Point3d.create(1, 1, 0), Point3d.create(4, 1, 0), Point3d.create(4, 2, 0), Point3d.create(0, 2, 0));
    const clipper = ClipPlane.createEdgeXY(Point3d.create(2, 0, 0), Point3d.create(0, 5, 0))!;
    // The linestring starts in, goes out, and comes back.  Verify 2 segments announced.
    let numAnnounce = 0;
    ls.announceClipIntervals(clipper,
      (_a0: number, _a1: number, _cp: CurvePrimitive) => {
        numAnnounce++;
      });
    ck.testExactNumber(numAnnounce, 2);
    expect(ck.getNumErrors()).equals(0);
  });

});
/**
 * Class to act as an iterator over points in a linestring.
 * * Internal data is:
 *   * pointer to the parent linestring
 *   * index of index of the next ponit to read.
 * * the parent LineString class
 */
class IterableLineStringPoint3dIterator implements Iterator<Point3d> {
  private _linestring: LineStringWithIterator;
  private _nextReadIndex: number;
  public constructor(linestring: LineStringWithIterator) {
    this._linestring = linestring;
    this._nextReadIndex = 0;
  }
  public next(): IteratorResult<Point3d> {
    const point = this._linestring.pointAt(this._nextReadIndex++);
    if (point)
      return { done: false, value: point };
    return { done: true, value: undefined } as any as IteratorResult<Point3d>;
  }
  public [Symbol.iterator](): IterableIterator<Point3d> { return this; }
}
/**
 * This is a linestring class which
 * * Stores its point data in a Float64Array (NOT as individual Point3d objects)
 * * has a `pointIterator ()` method which returns an iterator so that users can visit points with `for (const p of linestring.pointIterator()){}`
 */
class LineStringWithIterator {
  private _data: Float64Array;
  public constructor(points: Point3d[]) {
    this._data = new Float64Array(3 * points.length);
    let i = 0;
    for (const p of points) {
      this._data[i++] = p.x;
      this._data[i++] = p.y;
      this._data[i++] = p.z;
    }
  }
  public [Symbol.iterator](): IterableIterator<Point3d> { return new IterableLineStringPoint3dIterator(this); }
  /**
   * access a point by index.  The point coordinates are returned as a first class point object.
   * @param index index of point to access
   */
  public pointAt(index: number): Point3d | undefined {
    const k = index * 3;
    if (k < this._data.length)
      return new Point3d(this._data[k], this._data[k + 1], this._data[k + 2]);
    return undefined;
  }
}
describe("LineStringIterator", () => {

  it("HelloWorld", () => {
    const ck = new Checker();
    const allPoints: Point3d[] = [
      Point3d.create(0, 0, 0),
      Point3d.create(0, 10, 0),
      Point3d.create(10, 10, 0),
      Point3d.create(10, 0, 0),
      Point3d.create(20, 0, 0),
      Point3d.create(20, 10, 0)];
    const ls = new LineStringWithIterator(allPoints);
    for (const p of ls) {
      console.log("for..of ", p.toJSON());
    }
    expect(ck.getNumErrors()).equals(0);
  });

});
