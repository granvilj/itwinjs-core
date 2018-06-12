/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2018 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
/** @module LocatingElements */
import { Point3d, Vector3d, CurvePrimitive } from "@bentley/geometry-core";
import { Viewport } from "./Viewport";
import { Sprite } from "./Sprites";
import { DecorateContext } from "./frontend";

// tslint:disable:variable-name

export const enum SnapMode { // NEEDSWORK: Don't intend to use this as a mask, maybe remove in favor of using KeypointType native equivalent...
  Nearest = 1,
  NearestKeypoint = 1 << 1,
  MidPoint = 1 << 2,
  Center = 1 << 3,
  Origin = 1 << 4,
  Bisector = 1 << 5,
  Intersection = 1 << 6,
}

export const enum SnapHeat {
  None = 0,
  NotInRange = 1,   // "of interest", but out of range
  InRange = 2,
}

/** The procedure that generated this Hit. */
export const enum HitSource {
  None = 0,
  FromUser = 1,
  MotionLocate = 2,
  AccuSnap = 3,
  TentativeSnap = 4,
  DataPoint = 5,
  Application = 6,
  EditAction = 7,
  EditActionSS = 8,
}

/**
 * What was being tested to generate this hit. This is not the element or
 * GeometricPrimitive that generated the Hit, it is an indication of whether it is an
 * edge or interior hit.
 */
export const enum HitGeomType {
  None = 0,
  Point = 1,
  Segment = 2,
  Curve = 3,
  Arc = 4,
  Surface = 5,
}

export const enum HitPriority {
  WireEdge = 0,
  PlanarEdge = 1,
  NonPlanarEdge = 2,
  SilhouetteEdge = 3,
  PlanarSurface = 4,
  NonPlanarSurface = 5,
  Unknown = 6,
}

export const enum HitDetailType {
  Hit = 1,
  Snap = 2,
  Intersection = 3,
}

/**
 * A HitDetail identifies an approximate location on an element or pickable decoration. A HitDetail stores the result when locating geometry displayed in a view.
 */
export class HitDetail {
  /**
   * Create a new HitDetail from the inputs to and results of a locate operation.
   * @param testPoint The world coordinate space point that was used as the locate point.
   * @param viewport The view the locate operation was performed in.
   * @param hitSource The procedure that requested the locate operation.
   * @param hitPoint The approximate world coordinate location on the geometry identified by this HitDetail.
   * @param sourceId The source of the geometry, either a persistent element id or pickable decoration id.
   * @param priority The hit geometry priority/classification.
   * @param distXY The xy distance to hit in view coordinates.
   * @param distFraction The near plane distance fraction to hit.
   */
  public constructor(public readonly testPoint: Point3d, public readonly viewport: Viewport, public readonly hitSource: HitSource,
    public readonly hitPoint: Point3d, public readonly sourceId: string, public readonly priority: HitPriority, public readonly distXY: number, public readonly distFraction: number) { }

  public getHitType(): HitDetailType { return HitDetailType.Hit; }
  public getPoint(): Point3d { return this.hitPoint; }
  public isSnapDetail(): this is SnapDetail { return false; }
  public isSameHit(otherHit?: HitDetail): boolean { return (undefined !== otherHit && this.sourceId === otherHit.sourceId); }
  public isElementHit(): boolean { return true; } // NEEDSWORK: Check that sourceId is a valid Id64 for an element...
  public clone(): HitDetail { const val = new HitDetail(this.testPoint, this.viewport, this.hitSource, this.hitPoint, this.sourceId, this.priority, this.distXY, this.distFraction); return val; }
  public draw(context: DecorateContext) { context.drawHit(this); }
}

export class SnapDetail extends HitDetail {
  public snapMode: SnapMode;              // snap mode currently associated with this snap
  public heat = SnapHeat.None;
  public sprite?: Sprite;
  public readonly snapPoint: Point3d;     // hitPoint adjusted by snap
  public readonly adjustedPoint: Point3d; // sometimes accuSnap adjusts the point after the snap.
  public geomType = HitGeomType.None;     // type of hit geometry (edge or interior)
  public primitive?: CurvePrimitive;      // curve primitive for snap.
  public normal?: Vector3d;               // surface normal at snapPoint

  public constructor(from: HitDetail) {
    super(from.testPoint, from.viewport, from.hitSource, from.hitPoint, from.sourceId, from.priority, from.distXY, from.distFraction);
    this.snapMode = SnapMode.Nearest;
    this.snapPoint = this.hitPoint.clone();
    this.adjustedPoint = this.snapPoint.clone();
  }

  public getHitType(): HitDetailType { return HitDetailType.Snap; }
  public getPoint(): Point3d { return this.isHot() ? this.snapPoint : super.getPoint(); }
  public isSnapDetail(): this is SnapDetail { return true; }
  public isHot(): boolean { return this.heat !== SnapHeat.None; }
  public isPointAdjusted(): boolean { return !this.adjustedPoint.isAlmostEqual(this.snapPoint); }
  public setAdjustedPoint(point: Point3d) { this.adjustedPoint.setFrom(point); }
  public setSnapPoint(point: Point3d, heat: SnapHeat) { this.snapPoint.setFrom(point); this.adjustedPoint.setFrom(point); this.heat = heat; }

  public clone(): SnapDetail {
    const val = new SnapDetail(this);
    val.snapMode = this.snapMode;
    val.heat = this.heat;
    val.sprite = this.sprite;
    val.snapPoint.setFrom(this.snapPoint);
    val.adjustedPoint.setFrom(this.adjustedPoint);
    val.geomType = this.geomType;
    if (undefined !== this.primitive)
      val.primitive = this.primitive.clone() as CurvePrimitive;
    if (undefined !== this.normal)
      val.normal = this.normal.clone();
    return val;
  }
}

export class IntersectDetail extends SnapDetail {
  public secondHit?: SnapDetail;
}

/**
 * The result of a "locate" is a sorted list of objects that satisfied the search criteria (a HitList). Earlier hits in the list
 *  are somehow "better" than those later on.
 */
export class HitList {
  public hits: HitDetail[] = [];
  public currHit = -1;
  public size(): number { return this.hits.length; }
  public clear(): void { this.hits.length = 0; }
  public empty(): void { this.clear(); this.resetCurrentHit(); }
  public resetCurrentHit(): void { this.currHit = -1; }

  /**
   * get a hit from a particular index into a HitList
   * return       the requested hit from the HitList or undefined
   */
  public getHit(hitNum: number): HitDetail | undefined {
    if (hitNum < 0) hitNum = this.size() - 1;
    return (hitNum >= this.size()) ? undefined : this.hits[hitNum];
  }

  public setHit(i: number, p: HitDetail | undefined): void {
    if (i < 0 || i >= this.size())
      return;
    this.hits[i] = p!;
  }

  public dropNulls(): void {
    const hits = this.hits;
    this.hits = [];
    for (const hit of hits)
      this.hits.push(hit);
  }

  public getCurrentHit(): HitDetail | undefined { return -1 === this.currHit ? undefined : this.getHit(this.currHit); }
  public getNextHit(): HitDetail | undefined { this.currHit++; return this.getCurrentHit(); }

  /** remove a hit in the list. */
  public removeHit(hitNum: number) {
    if (hitNum < 0)                   // Support -1 == END
      hitNum = this.size() - 1;

    if (hitNum >= this.currHit)
      this.currHit = -1;

    if (hitNum >= this.size())        // Locate calls GetNextHit, which increments currHit, until it goes beyond the end of size of the array.
      return;                         // Then Reset call RemoteCurrentHit, which passes in currHit. When it is out of range, we do nothing.

    this.hits.splice(hitNum, 1);
  }

  /** search through list and remove any hits that contain a specified element id. */
  public removeHitsFrom(sourceId: string): boolean {
    let removedOne = false;

    // walk backwards through list so we don't have to worry about what happens on remove
    for (let i = this.size() - 1; i >= 0; i--) {
      const thisHit = this.hits[i];
      if (thisHit && sourceId === thisHit.sourceId)
        removedOne = true;
      this.removeHit(i);
    }
    return removedOne;
  }

  private getPriorityZOverride(priority: HitPriority): number {
    switch (priority) {
      case HitPriority.WireEdge:
      case HitPriority.PlanarEdge:
      case HitPriority.NonPlanarEdge:
        return 0;
      case HitPriority.SilhouetteEdge:
        return 1;
      case HitPriority.PlanarSurface:
      case HitPriority.NonPlanarSurface:
        return 2;
      default:
        return 3;
    }
  }

  /**
   * compare two hits for insertion into list. Hits are compared by calling getLocatePriority() and then getLocateDistance() on each.
   */
  public compare(hit1: HitDetail | undefined, hit2: HitDetail | undefined): -1 | 1 | 0 {
    if (!hit1 || !hit2)
      return 0;

    const zOverride1 = this.getPriorityZOverride(hit1.priority);
    const zOverride2 = this.getPriorityZOverride(hit2.priority);

    // Compare edge vs. surface, this is more important than z because we know it's visible in the view...
    if (zOverride1 < zOverride2) return -1;
    if (zOverride1 > zOverride2) return 1;

    // Compare distance fraction, prefer hits closer to eye...
    if (hit1.distFraction < hit2.distFraction) return -1;
    if (hit1.distFraction > hit2.distFraction) return 1;

    // Compare geometry class, prefer path/region hits at same distance from eye to surface hits...
    if (hit1.priority < hit2.priority) return -1;
    if (hit1.priority > hit2.priority) return 1;

    // Compare xy distance from pick point, prefer hits closer to center...
    if (hit1.distXY < hit2.distXY) return -1;
    if (hit1.distXY > hit2.distXY) return 1;

    return 0;
  }

  /**
   * Add a new hit to the list. Hits are sorted according to their priority and distance.
   */
  public addHit(newHit: HitDetail): number {
    if (this.size() === 0) {
      this.hits.push(newHit);
      return 0;
    }

    let index = 0;
    for (; index < this.size(); ++index) {
      let oldHit = this.hits[index];
      const comparison = this.compare(newHit, oldHit);
      if (newHit.isSameHit(oldHit)) {
        if (comparison < 0)
          oldHit = newHit; // replace with new hit since it's better
        return this.size(); // ignore new hit...
      }
      if (comparison < 0)
        break;
    }

    this.hits.splice(index, 0, newHit);
    return index;
  }

  public removeCurrentHit() { this.removeHit(this.currHit); }

  public setCurrentHit(hit: HitDetail): void {
    this.resetCurrentHit();
    for (let thisHit; undefined !== (thisHit = this.getNextHit());) {
      if (thisHit === hit)
        return;
    }
  }

  public insert(i: number, hit: HitDetail): void {
    if (i < 0 || i >= this.size())
      this.hits.push(hit);
    else
      this.hits.splice(i, 0, hit);
  }
}
