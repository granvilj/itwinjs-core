/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2017 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
import { Point3d, Vector3d, Point2d, XAndY } from "@bentley/geometry-core/lib/PointVector";
import { CurvePrimitive } from "@bentley/geometry-core/lib/curve/CurvePrimitive";
import { Id64 } from "@bentley/bentleyjs-core/lib/Id";
import { Viewport } from "./Viewport";
import { ViewManager } from "./ViewManager";
import { BeButtonEvent } from "./tools/Tool";
import { TentativePoint } from "./TentativePoint";
import { ElementLocateManager, LocateFailureValue, SnapStatus, LocateAction, LocateResponse } from "./ElementLocateManager";
import { SpriteLocation, Sprite } from "./Sprites";
import { ToolAdmin } from "./tools/ToolAdmin";
import { DecorateContext } from "./ViewContext";
import { RenderMode } from "../common/Render";
import { Geometry } from "@bentley/geometry-core/lib/Geometry";
import { Point4d } from "@bentley/geometry-core/lib/numerics/Geometry4d";

// tslint:disable:variable-name
// tslint:disable:no-conditional-assignment
const s_unfocused: any = {};
const s_focused: any = {};
const s_notSnappable: any = {};
const s_appFiltered: any = {};

class AccuSnapToolState {
  public m_enabled: boolean;
  public m_locate: boolean;
  public m_suspended: number;
  public m_subSelectionMode: number;
}

class SnapElemIgnore {
  public text: boolean;
  public curves: boolean;
  public dimensions: boolean;
  public meshes: boolean;
  public fillInterior: boolean;
}

class AccuSnapSettings {
  public hotDistanceFactor: number;
  public stickyFactor: number;
  public searchDistance: number;
  public enableForFenceCreate: boolean;
  public showIcon: boolean;
  public showHint: boolean;
  public fixedPtPerpTan: boolean;
  public playSound: boolean;
  public coordUpdate: boolean;
  public hiliteColdHits: boolean;
  public popupInfo: boolean;
  public popupMode: boolean;
  public enableFlag: boolean;
  public readonly ignore = new SnapElemIgnore();
  public popupDelay: number; // delay before info balloon pops up - in 10th of a second
}

export const enum SnapMode {
  Invalid = -1,
  First = 0,
  None = 0,
  Nearest = 1,
  NearestKeypoint = 1 << 1,
  MidPoint = 1 << 2,
  Center = 1 << 3,
  Origin = 1 << 4,
  Bisector = 1 << 5,
  Intersection = 1 << 6,
  Tangency = 1 << 7,
  TangentPoint = 1 << 8,
  Perpendicular = 1 << 9,
  PerpendicularPoint = 1 << 10,
  Parallel = 1 << 11,
  Multi3 = 1 << 12,
  PointOn = 1 << 13,
  Multi1 = 1 << 14,
  Multi2 = 1 << 15,
  MultiSnaps = (Multi1 | Multi2 | Multi3),
  AllOrdinary = (Nearest | NearestKeypoint | MidPoint | Center | Origin | Bisector | Intersection | MultiSnaps),
  AllConstraint = (Tangency | TangentPoint | Perpendicular | PerpendicularPoint | Parallel | PointOn),
  IntersectionCandidate = (Intersection | Nearest),
  NumSnapModes = 16,
}

export const enum SnapHeat {
  SNAP_HEAT_None = 0,
  SNAP_HEAT_NotInRange = 1,   // "of interest", but out of range
  SNAP_HEAT_InRange = 2,
}

export const enum KeypointType {
  KEYPOINT_TYPE_Nearest = 0,
  KEYPOINT_TYPE_Keypoint = 1,
  KEYPOINT_TYPE_Midpoint = 2,
  KEYPOINT_TYPE_Center = 3,
  KEYPOINT_TYPE_Origin = 4,
  KEYPOINT_TYPE_Bisector = 5,
  KEYPOINT_TYPE_Intersection = 6,
  KEYPOINT_TYPE_Tangent = 7,
  KEYPOINT_TYPE_Tangentpoint = 8,
  KEYPOINT_TYPE_Perpendicular = 9,
  KEYPOINT_TYPE_Perpendicularpt = 10,
  KEYPOINT_TYPE_Parallel = 11,
  KEYPOINT_TYPE_Point = 12,
  KEYPOINT_TYPE_PointOn = 13,
  KEYPOINT_TYPE_Unknown = 14,
  KEYPOINT_TYPE_Custom = 15,
}

export const enum SubSelectionMode {
  /** Select entire element - No sub-selection */
  None = 0,
  /** Select single DgnGeometryPart */
  Part = 1,
  /** Select single GeometricPrimitive */
  Primitive = 2,
  /** Select single ICurvePrimitive/line string segment of open paths, and planar regions. */
  Segment = 3,
}

/*  Lower numbers are "better" (more important) Hits than ones with higher numbers. */
export const enum HitPriority {
  Highest = 0,
  Vertex = 300,
  Origin = 400,
  Edge = 400,
  TextBox = 500,
  Region = 550,
  Interior = 600,
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
 * GeometricPrimitive that generated the Hit, it's an indication of whether it's an
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

/** Indicates whether the GeometricPrimitive that generated the hit was a wire, surface, or solid. */
export const enum HitParentGeomType {
  None = 0,
  Wire = 1,
  Sheet = 2,
  Solid = 3,
  Mesh = 4,
  Text = 5,
}

/** Hit detail source can be used to tell what display operation generated the geometry */
export const enum HitDetailSource {
  None = 0,
  LineStyle = 1,
  Pattern = 1 << 1,
  Thickness = 1 << 2,
  PointCloud = 1 << 3,
  Sprite = 1 << 4,
}

export interface ElemTopology {
  /** Create a deep copy of this object. */
  clone(): ElemTopology;

  /** Compare objects and return true if they should be considered the same. */
  isEqual(other: ElemTopology): boolean;

  //   //! Return GeometrySource to handle requests related to transient geometry (like locate) where we don't have an DgnElement.
  //   toGeometrySource(): GeometrySource;
  // //! Return IEditManipulator for interacting with transient geometry.
  // //! @note Implementor is expected to check hit.GetDgnDb().IsReadonly().
  // virtual IEditManipulatorPtr _GetTransientManipulator(HitDetailCR) const { return nullptr;}
}

export class GeomDetail {
  public m_primitive?: CurvePrimitive;         // curve primitive for hit (world coordinates).
  public readonly m_closePoint = new Point3d(); // the closest point on geometry (world coordinates).
  public readonly m_normal = new Vector3d();  // surface hit normal (world coordinates).
  public m_parentType = HitParentGeomType.None;     // type of parent geometry.
  public m_geomType = HitGeomType.None;             // type of hit geometry (edge or interior).
  public m_detailSource = HitDetailSource.None;     // mask of HitDetailSource values.
  public m_hitPriority = HitPriority.Highest;          // Relative priority of hit.
  public m_nonSnappable = false;             // non-snappable detail, ex. pattern or line style.
  public m_viewDist = 0;                  // xy distance to hit (view coordinates).
  public m_viewZ = 0;                     // z distance to hit (view coordinates).
  public m_geomId?: Id64;                      // id of geometric primitive that generated this hit

  public clone(): GeomDetail {
    const other = new GeomDetail();
    other.setFrom(this);
    return other;
  }
  public setFrom(other: GeomDetail): void {
    other.m_primitive = this.m_primitive;
    other.m_closePoint.setFrom(this.m_closePoint);
    other.m_normal.setFrom(this.m_normal);
    other.m_parentType = this.m_parentType;
    other.m_geomType = this.m_geomType;
    other.m_detailSource = this.m_detailSource;
    other.m_hitPriority = this.m_hitPriority;
    other.m_nonSnappable = this.m_nonSnappable;
    other.m_viewDist = this.m_viewDist;
    other.m_viewZ = this.m_viewZ;
    other.m_geomId = this.m_geomId;
  }
}

export const enum HitDetailType {
  Hit = 1,
  Snap = 2,
  Intersection = 3,
}

export class HitDetail {
  public m_elemTopo?: ElemTopology; // details about the topology of the element.
  public m_hitDescription: string;
  public m_subSelectionMode = SubSelectionMode.None; // segment hilite/flash mode.

  public constructor(public m_viewport: Viewport, public m_sheetViewport: Viewport | undefined, public m_elementId: Id64, public m_testPoint: Point3d, public m_locateSource: HitSource, public m_geomDetail: GeomDetail) { }

  public isSnapDetail(): this is SnapDetail { return false; }
  public getHitType(): HitDetailType { return HitDetailType.Hit; }
  public isSameHit(otherHit?: HitDetail): boolean {
    if (!otherHit || this.m_elementId.equals(otherHit.m_elementId))
      return false;

    if (!this.m_elemTopo && !otherHit.m_elemTopo)
      return true;

    if (this.m_elemTopo && !otherHit.m_elemTopo)
      return false;

    return this.m_elemTopo!.isEqual(otherHit.m_elemTopo!);
  }
  public draw(context: DecorateContext): void { context.drawHit(this); }
}

export class SnapDetail extends HitDetail {
  public m_heat = SnapHeat.SNAP_HEAT_None;
  public readonly m_screenPt = new Point2d();
  public m_divisor: number;
  public m_sprite?: Sprite;
  public m_snapMode: SnapMode;            // snap mode currently associated with this snap
  public m_originalSnapMode: SnapMode;    // snap mode used when snap was created, before constraint override was applied
  public m_minScreenDist: number;         // minimum distance to element in screen coordinates.
  public readonly m_snapPoint: Point3d;   // hitpoint adjusted by snap
  public readonly m_adjustedPt: Point3d;  // sometimes accusnap adjusts the point after the snap.
  public m_customKeypointSize = 0;
  public m_customKeypointData?: any;
  public m_allowAssociations = true;

  public constructor(from: HitDetail) {
    super(from.m_viewport, from.m_sheetViewport, from.m_elementId, from.m_testPoint, from.m_locateSource, from.m_geomDetail);
    this.m_snapPoint = this.m_geomDetail.m_closePoint.clone();
    this.m_adjustedPt = this.m_snapPoint.clone();
    this.m_snapMode = this.m_originalSnapMode = SnapMode.First;

    if (from.isSnapDetail()) {
      this.m_minScreenDist = from.m_minScreenDist;
    } else {
      this.m_minScreenDist = this.m_geomDetail.m_viewDist;
      this.m_geomDetail.m_viewDist = 0.0;
    }
  }

  public isSnapDetail(): this is SnapDetail { return true; }
  public getAdjustedPoint() { return this.m_adjustedPt; }
  public isHot(): boolean { return this.m_heat !== SnapHeat.SNAP_HEAT_None; }
  public getHitType(): HitDetailType { return HitDetailType.Snap; }
  public getHitPoint(): Point3d { return this.isHot() ? this.m_snapPoint : this.m_geomDetail.m_closePoint; }
}

/**
 * The result of a "locate" is a sorted list of objects that satisfied the search criteria (a HitList). Earlier hits in the list
 *  are somehow "better" than those later on.
 */
export class HitList {
  public readonly hits: HitDetail[];
  private m_currHit: number;

  public size(): number { return this.hits.length; }
  public clear(): void { this.hits.length = 0; }
  public empty(): void { this.clear(); this.resetCurrentHit(); }
  public resetCurrentHit(): void { this.m_currHit = -1; }

  /**
   * get a hit from a particular index into a HitList
   * return       the requested hit from the HitList or undefined
   */
  public getHit(hitNum: number): HitDetail | undefined {
    if (hitNum < 0) hitNum = this.size() - 1;
    return (hitNum >= this.size()) ? undefined : this.hits[hitNum];
  }

  public getCurrentHit(): HitDetail | undefined { return -1 === this.m_currHit ? undefined : this.getHit(this.m_currHit); }
  public getNextHit(): HitDetail | undefined { this.m_currHit++; return this.getCurrentHit(); }

  /** remove a hit in the list. */
  public removeHit(hitNum: number) {
    if (hitNum < 0)                     // *** NEEDS WORK: The old ObjectArray used to support -1 == END
      hitNum = this.size() - 1;

    if (hitNum >= this.m_currHit)
      this.m_currHit = -1;

    if (hitNum >= this.size())        // Locate calls GetNextHit, which increments m_currHit, until it goes beyond the end of size of the array.
      return;                         // Then Reset call RemoteCurrentHit, which passes in m_currHit. When it's out of range, we do nothing.

    this.hits.splice(hitNum, 1);
  }

  /** search through list and remove any hits that contain a specified element id. */
  public removeHitsFrom(element: Id64): boolean {
    let removedOne = false;

    // walk backwards through list so we don't have to worry about what happens on remove
    for (let i = this.size() - 1; i >= 0; i--) {
      const thisHit = this.hits[i];
      if (thisHit && element.equals(thisHit.m_elementId))
        removedOne = true;
      this.removeHit(i);
    }
    return removedOne;
  }

  private static s_tooCloseTolerance = 1.0e-10;
  private static doZCompareOfSurfaceAndEdge(oHitSurf: HitDetail, oHitEdge: HitDetail): number {
    const origin = oHitSurf.m_geomDetail.m_closePoint;
    const normal = oHitSurf.m_geomDetail.m_normal;
    const homogeneousPlane = Point4d.createFromPointAndWeight(normal, -normal.dotProduct(origin));
    const worldToViewMap = oHitSurf.m_viewport.rootToView;
    const eyePointWorld = worldToViewMap.transform1Ref().columnZ();
    const testPointWorld = oHitEdge.m_geomDetail.m_closePoint;
    const a0 = homogeneousPlane.dotProduct(eyePointWorld);
    const a1 = homogeneousPlane.dotProductXYZW(testPointWorld.x, testPointWorld.y, testPointWorld.z, 1.0);
    const tol = HitList.s_tooCloseTolerance * (1.0 + Math.abs(a0) + Math.abs(a1) + Math.abs(homogeneousPlane.w));
    return (Math.abs(a1) < tol) ? 0 : ((a0 * a1 > 0) ? 1 : -1);
  }

  private static doZCompare(oHit1: HitDetail, oHit2: HitDetail): number {
    const z1 = oHit1.m_geomDetail.m_viewZ;
    const z2 = oHit2.m_geomDetail.m_viewZ;

    // For 2d hits z reflects display priority which should be checked before locate priority, etc. when a fill/surface hit is involved...
    if (!oHit1.m_viewport.view.is3d()) {
      // screen z values are sorted descending
      if (z2 < z1) return -1;
      if (z2 > z1) return 1;
      return 0;
    }

    // Point clouds already output only a single best z for a screen location...only compare using screen distance, not z...
    if (HitDetailSource.PointCloud === oHit1.m_geomDetail.m_detailSource && HitDetailSource.PointCloud === oHit2.m_geomDetail.m_detailSource)
      return 0;

    // Always prioritize sprites (ex. HUD markers) over surface hits...
    if (HitDetailSource.Sprite === oHit1.m_geomDetail.m_detailSource || HitDetailSource.Sprite === oHit2.m_geomDetail.m_detailSource)
      return 0;

    const normal1 = oHit1.m_geomDetail.m_normal;
    const normal2 = oHit2.m_geomDetail.m_normal;

    // NOTE: Only surfaces display hidden edges...NEEDSWORK: Nothing is hidden by transparent display style (RenderMode::SmoothShade)...
    const flags1 = oHit1.m_viewport.view.displayStyle.viewFlags;
    const flags2 = oHit2.m_viewport.view.displayStyle.viewFlags;
    const hiddenEdgesVisible = flags1.hiddenEdgesVisible();
    const isObscurableWireHit1 = (RenderMode.Wireframe !== flags1.renderMode && HitParentGeomType.Wire === oHit1.m_geomDetail.m_parentType);
    const isObscurableWireHit2 = (RenderMode.Wireframe !== flags2.renderMode && HitParentGeomType.Wire === oHit2.m_geomDetail.m_parentType);

    const mag1 = normal1.magnitude();
    const mag2 = normal2.magnitude();
    if (0.0 !== mag1 && 0.0 !== mag2) {
      // Both surface hits...if close let other criteria determine order...
      if (Geometry.isDistanceWithinTol(z1 - z2, HitList.s_tooCloseTolerance))
        return 0;
    } else if (0.0 !== mag1) {
      // 1st is surface hit...project 2nd hit into plane defined by surface normal...
      const compareResult = (hiddenEdgesVisible && !isObscurableWireHit2) ? 1 : HitList.doZCompareOfSurfaceAndEdge(oHit1, oHit2);
      return (0 === compareResult ? 0 : compareResult);
    }
    if (0.0 !== mag2) {
      // 2nd is surface hit...project 1st hit into plane defined by surface normal...
      const compareResult = (hiddenEdgesVisible && !isObscurableWireHit1) ? 1 : HitList.doZCompareOfSurfaceAndEdge(oHit2, oHit1);
      return (0 === compareResult ? 0 : -compareResult);
    }
    // else {
    //   // NOTE: I don't believe this case currently exists...silhouette hits are only created for cones/spheres and always have a curve primitive...
    //   bool isSilhouetteHit1 = (HitGeomType:: Surface == oHit1.GetGeomDetail().GetGeomType() && NULL == oHit1.GetGeomDetail().GetCurvePrimitive());
    //   bool isSilhouetteHit2 = (HitGeomType:: Surface == oHit2.GetGeomDetail().GetGeomType() && NULL == oHit2.GetGeomDetail().GetCurvePrimitive());

    //   // NOTE: Likely silhouette hit, make sure it always loses to a real edge hit...
    //   if (isSilhouetteHit1 && !isSilhouetteHit2)
    //     return 1;
    //   if (isSilhouetteHit2 && !isSilhouetteHit1)
    //     return -1;
    //   if (DoubleOps:: WithinTolerance(z1, z2, s_tooCloseTolerance))
    //   return 0; // Both silhouette or real edge hits...if close let other criteria determine order...
    // }

    // screen z values are sorted descending
    return (z2 < z1) ? -1 : (z2 > z1) ? 1 : 0;
  }

  private static tenthOfPixel(inValue: number): number { return Math.floor((inValue * 10.0) + 0.5) / 10.0; }
  /**
   * compare two hits for insertion into list. Hits are compared by calling getLocatePriority() and then getLocateDistance() on each.
   */
  public compare(oHit1: HitDetail | undefined, oHit2: HitDetail | undefined, comparePriority: boolean, compareZ: boolean): number {
    if (!oHit1 || !oHit2)
      return 0;

    if (compareZ) {
      const zCompareValue = HitList.doZCompare(oHit1, oHit2);
      if (0 !== zCompareValue)
        return zCompareValue;
    }

    if (comparePriority) {
      const p1 = oHit1.m_geomDetail.m_hitPriority;
      const p2 = oHit2.m_geomDetail.m_hitPriority;
      if (p2 < p1) return -1;
      if (p2 > p1) return 1;
    }

    const dist1 = HitList.tenthOfPixel(oHit1.m_geomDetail.m_viewDist);
    const dist2 = HitList.tenthOfPixel(oHit2.m_geomDetail.m_viewDist);
    if (dist2 < dist1) return -1;
    if (dist2 > dist1) return 1;

    // Linestyle/pattern/thickness hits have lower priority...
    const source1 = oHit1.m_geomDetail.m_detailSource;
    const source2 = oHit2.m_geomDetail.m_detailSource;
    return (source2 < source1) ? -1 : (source2 > source1) ? 1 : 0;
  }

  /**
   * Add a new hit to the list. Hits are sorted according to their priority and distance.
   */
  public addHit(newHit: HitDetail, _allowDuplicates: boolean, comparePriority: boolean): number {
    if (this.size() === 0) {
      this.hits.push(newHit);
      return 0;
    }

    // NOTE: Starting from the end ensures that all edge hits will get compared against surface hits to properly
    //       determine their visibility. With a forward iterator, an edge hit could end up being chosen that is obscured
    //       if it is closer to the eye than an un-obscured edge hit.
    let index = this.size() - 1;
    for (; index >= 0; --index) {
      const comparison = this.compare(this.hits[index], newHit, comparePriority, true);
      if (comparison >= 0)
        continue;
      break;
    }

    this.hits.splice(index, 0, newHit);
    return index;
  }

  public setCurrentHit(hit: HitDetail): void {
    this.resetCurrentHit();
    for (let thisHit; undefined !== (thisHit = this.getNextHit());) {
      if (thisHit === hit)
        return;
    }
  }
}

export class AccuSnap {
  public static instance = new AccuSnap();
  public m_currHit?: HitDetail;                  // currently active hit
  public m_aSnapHits?: HitList;                  // current list of hits.
  public readonly m_retestList = new HitList();
  public readonly m_needFlash = new Set<Viewport>();    // views that need to be flashed
  public readonly m_areFlashed = new Set<Viewport>();   // views that are already flashed
  public readonly m_cross = new SpriteLocation();            // the "+" that indicates where the snap point is
  public readonly m_icon = new SpriteLocation();             // the icon that indicates what type of snap is active
  public readonly m_errorIcon = new SpriteLocation();        // the icon that indicates an error
  public m_errorReason: LocateFailureValue;      // reason code for last error
  public m_explanation?: string;     // why last error was generated.
  private m_candidateSnapMode = SnapMode.First; // during snap creation: the snap to try
  private m_suppressed = 0;       // number of times "suppress" has been called -- unlike m_suspend this is not automatically cleared by tools
  // bool                m_wasAborted;       // was the search for elements from last motion event aborted?
  private m_waitingForTimeout = false;
  // bool                m_changedCurrentHit;
  private m_noMotionCount = 0;   // number of times "noMotion" has been called since last motion
  private readonly m_infoPt = new Point3d();           // anchor point for infoWindow. window is cleared when cursor moves away from this point.
  // Point2d             m_lastCursorPos;    // Location of cursor when we last checked for motion
  // int                 m_totalMotionSq;    // Accumulated distance (squared) the mouse has moved since we started checking for motion
  // int                 m_motionToleranceSq;// How much mouse movement constitutes a "move" (squared)
  private readonly m_toolstate = new AccuSnapToolState();
  private readonly m_defaultSettings = new AccuSnapSettings();
  private m_settings = this.m_defaultSettings;

  private wantShowIcon() { return this.m_settings.showIcon; }
  private wantShowHint() { return this.m_settings.showHint; }
  private wantInfoBalloon() { return this.m_settings.popupInfo; }
  private wantAutoInfoBalloon() { return this.m_settings.popupInfo && !this.m_settings.popupMode; }
  private wantHiliteColdHits() { return this.m_settings.hiliteColdHits; }
  private getStickyFactor() { return this.m_settings.stickyFactor; }
  private doLocateTesting() { return this.isLocateEnabled(); }
  private getSearchDistance() { return this.doLocateTesting() ? 1.0 : this.m_settings.searchDistance; }
  private getPopupDelay() { return this.m_settings.popupDelay; }
  private getHotDistanceInches() { return elementLocateManager.getApertureInches() * this.m_settings.hotDistanceFactor; }
  public isLocateEnabled() { return this.m_toolstate.m_locate; }
  private isFlashed(view: Viewport): boolean { return (this.m_areFlashed.has(view)); }
  private needsFlash(view: Viewport): boolean { return (this.m_needFlash.has(view)); }
  private setNeedsFlash(view: Viewport) { this.m_needFlash.add(view); this.clearIsFlashed(view); view.invalidateDecorations(); }
  private setIsFlashed(view: Viewport) { this.m_areFlashed.add(view); }
  private clearIsFlashed(view: Viewport) { this.m_areFlashed.delete(view); }
  private isSnapEnabled(): boolean { return this.m_toolstate.m_enabled; }
  private getUserEnabled(): boolean { return this.m_settings.enableFlag; }
  private userWantsSnaps(): boolean { return this.getUserEnabled(); }
  private static toSnapDetail(hit?: HitDetail): SnapDetail | undefined { return (hit && hit.isSnapDetail()) ? hit : undefined; }
  public getCurrSnapDetail(): SnapDetail | undefined { return AccuSnap.toSnapDetail(this.m_currHit); }
  public isHot(): boolean {
    const currSnap = this.getCurrSnapDetail(); return !currSnap ? false : currSnap.isHot();
  }
  public destroy(): void {
    this.m_currHit = undefined;
    this.m_aSnapHits = undefined;
    this.m_retestList.empty();
  }
  private doSnapping(): boolean { return this.isSnapEnabled() && this.userWantsSnaps() && !this.isSnapSuspended(); }
  private isSnapSuspended(): boolean { return (0 !== this.m_suppressed || 0 !== this.m_toolstate.m_suspended); }
  public getSnapMode(): SnapMode { return this.m_candidateSnapMode !== SnapMode.First ? this.m_candidateSnapMode : SnapMode.Nearest; }
  public setSubSelectionMode(newMode: SubSelectionMode) { this.m_toolstate.m_subSelectionMode = newMode; }

  private isActivePointSnap(snapModeToFind: SnapMode): boolean {
    const snaps = elementLocateManager.getPreferredPointSnapModes(HitSource.AccuSnap);
    for (const snap of snaps) { if (snap === snapModeToFind) return true; }
    return false;
  }

  /**
   * Check to see whether its appropriate to generate an AccuSnap point, given the current user
   * and command settings, and whether a tentative point is currently active.
   */
  public isActive(): boolean {
    // Unless we're snapping in intersect mode (to find extended intersections), skip if tentative point active...
    if (tentativePoint.m_isActive)
      return this.isActivePointSnap(SnapMode.Intersection) && this.doSnapping();

    return this.doSnapping() || this.doLocateTesting();
  }

  /** clear any AccuSnap info on the screen and release any hit path references */
  public clear(): void { this.setCurrHit(undefined); }
  public setCurrHit(newHit?: HitDetail): void {
    const newSnap = AccuSnap.toSnapDetail(newHit);
    const currSnap = this.getCurrSnapDetail();
    const sameElem = (newHit && newHit.isSameHit(this.m_currHit));
    const sameHit = (sameElem && !newSnap);
    const sameSnap = (sameElem && newSnap && currSnap);
    const samePt = (sameHit || (sameSnap && newSnap!.m_screenPt.isExactEqual(currSnap!.m_screenPt)));
    const sameHot = (sameHit || (sameSnap && (this.isHot() === newSnap!.isHot())));
    const sameBaseSnapMode = (!newSnap || !currSnap || newSnap.m_originalSnapMode === currSnap.m_originalSnapMode);
    const sameType = (sameHot && (!currSnap || (currSnap.getHitType() === newHit!.getHitType())));

    // NOTE: When snapping and not also locating, flash component instead of cursor index
    //       Component mode when locating is handled by FilterHit.
    //       For intersect snap, always show only the segments that intersect.
    if (newSnap) {
      if (HitDetailType.Intersection === newSnap.getHitType() || !this.doLocateTesting())
        newSnap.m_subSelectionMode = SubSelectionMode.Segment;
    }

    // see if it's the same point on the same element, the hot flags are the same multiple snaps, and the snap modes are the same
    if (samePt && sameType && sameBaseSnapMode) {
      // we know that nothing about the screen could change, just save the new hit and return to avoid screen flash
      this.m_currHit = newHit;
      return;
    }

    this.erase();

    // if we hit the same element with the same "hotness" as last time, we don't need to erase it
    //  multiple snaps: but only if the old and new snap modes are the same
    if (!sameHot || !sameBaseSnapMode) {
      this.unFlashViews();
      this.setFlashHit(newHit);
    }

    // we already have a hit. Release our reference to it (leave element hilited though).
    this.m_currHit = undefined;

    // if we didn't get a new hit, we're done
    if (!newHit)
      return;

    // draw sprites for this hit
    this.showSnapSprite();
  }

  /**  flash a hit in a single view. */
  private flashHitInView(hit: HitDetail, context: DecorateContext) {
    const viewport = context.viewport;
    if (!this.hitShouldBeHilited(hit) || !this.needsFlash(viewport))
      return;

    // AccuSnapHandler:: AsnapStatus status = AccuSnapHandler:: Ok;
    // m_eventHandlers.CallAllHandlers(FlashCaller(& context, hit, & status));
    // if (AccuSnapHandler:: Ok == status)
    // {
    hit.draw(context);
    viewport.setFlashed(hit.m_elementId, 0.25);
    // }
    this.setIsFlashed(viewport);
  }

  private setNeedsFlashView(view: Viewport) {
    if (this.isFlashed(view) || this.needsFlash(view))
      return;
    this.setNeedsFlash(view);
  }

  /** flash a hit in its view. */
  public setFlashHit(hit?: HitDetail): void {
    if (!hit || !this.hitShouldBeHilited(hit))
      return;
    this.setNeedsFlashView(hit.m_viewport!);
    const snap = AccuSnap.toSnapDetail(hit);
    if (snap && snap.isHot())
      elementLocateManager.onFlashHit(snap);
  }

  public erase(): void {
    this.clearInfoBalloon(undefined); // make sure there's no info balloon up.
    this.clearSprites(); // remove all sprites from the screen
  }

  public showElemInfo(viewPt: Point3d, vp: Viewport, hit: HitDetail): void {
    if (viewManager.doesHostHaveFocus())
      this.showLocateMessage(viewPt, vp, toolAdmin.getInfoString(hit, "\n"));
  }

  public showLocateMessage(viewPt: Point3d, vp: Viewport, msg: string) {
    if (!viewManager.doesHostHaveFocus())
      return;

    // AccuSnapHandler:: AsnapStatus status = AccuSnapHandler:: Ok;

    // Utf8String msg(msgIn);
    // msg.Trim();

    // // if any event handlers say "don't show" then popup won't appear, but call them all regardless.
    // m_eventHandlers.CallAllHandlers(ShowInfoCaller(& viewPt, & vp, msg.c_str(), & status));
    // if (status != AccuSnapHandler:: DontShow)

    viewManager.showInfoWindow(viewPt, vp, msg);
  }

  public displayInfoBalloon(viewPt: Point3d, vp: Viewport, uorPt?: Point3d): void {
    this.m_waitingForTimeout = false;

    // if the info balloon is already displayed, or if he doesn't want it, quit.
    if (viewManager.isInfoWindowUp() || !this.wantInfoBalloon())
      return;

    const accuSnapHit = this.m_currHit;
    const tpHit = tentativePoint.getCurrSnap();

    // if we don't have either an accusnap or a tentative point hit, quit.
    if (!accuSnapHit && !tpHit && !this.m_errorIcon.isActive())
      return;

    let timeout = this.getPopupDelay();
    let theHit: HitDetail | undefined;

    // determine which type of hit and how long to wait, and the detail level
    if (tpHit) {
      // when the tentative button is first pressed, we pass nullptr for uorPt so that we show the info window immediately
      if (uorPt) {
        // const aperture = (this.getStickyFactor() * vp.pixelsFromInches(elementLocateManager.getApertureInches()) / 2.0) + 1.5;

        // // see if he came back somewhere near the currently snapped element
        // if (TestHitStatus.IsOn != elementLocateManager.getElementPicker().TestHit(tpHit, testList, vp, uorPt, aperture, & tester, elementLocateManager.m_options))
        //   return;

        // calls destructor on testList, frees hits in that list.
        timeout = 3;
      } else {
        // if uorPt is nullptr, that means that we want to display the infoWindow immediately.
        timeout = 0;
      }

      theHit = tpHit;
    } else {
      // auto-info popup?
      if (!this.wantAutoInfoBalloon())
        return;

      theHit = accuSnapHit;
    }

    // have we waited long enough to show the balloon?
    if (this.m_noMotionCount < timeout) {
      this.m_waitingForTimeout = true;
      return;
    }

    this.m_infoPt.setFrom(viewPt);

    // if we're currently showing an error, get the error message...otherwise display hit info...
    if (!this.m_errorIcon.isActive() && theHit) {
      this.showElemInfo(viewPt, vp, theHit);
      return;
    }

    // If we have an error explanation...use it as is!
    if (this.m_explanation) {
      this.showLocateMessage(viewPt, vp, this.m_explanation);
      return;
    }

    // if we don't have an explanation yet, translate the error code.
    if (0 === this.m_errorReason)
      return;

    this.m_explanation = elementLocateManager.getLocateError(this.m_errorReason);
    if (!this.m_explanation)
      return;

    // Get the "best" rejected hit to augment the error explanation with the hit info...
    if (!theHit)
      theHit = this.m_aSnapHits ? this.m_aSnapHits.hits[0] : undefined;

    if (!theHit) {
      this.showLocateMessage(viewPt, vp, this.m_explanation);
      return;
    }

    const msgStr = this.m_explanation + "\n" + theHit.m_hitDescription;
    this.showLocateMessage(viewPt, vp, msgStr);
  }

  public clearInfoBalloon(ev?: BeButtonEvent): void {
    this.m_noMotionCount = 0;
    this.m_waitingForTimeout = false;     // necessary in case we exit the view

    if (!viewManager.isInfoWindowUp())
      return;

    if (ev && (5 > ev.viewPoint.distanceXY(this.m_infoPt)))
      return;

    // if (nullptr != t_viewHost -> GetViewManager().GetInfoWindowOwner())
    //   return;
    // // notify any event handlers
    // m_eventHandlers.CallAllHandlers(RemoveInfoCaller());
    viewManager.clearInfoWindow();
  }

  /** For a given snap path, display the sprites to indicate its position on the screen and what snap mode it represents. */
  public showSnapSprite(): void {
    const snap = this.getCurrSnapDetail();
    if (!snap)
      return;

    const crossPt = snap.m_snapPoint;
    const crossSprite = snap.isHot() ? s_focused : s_unfocused;
    const viewport = snap.m_viewport!;

    if (!snap.isHot() && !this.wantShowHint())
      return;

    this.m_cross.activate(crossSprite, viewport, crossPt, 0);

    // user can say to skip display of the icon
    if (!this.wantShowIcon())
      return;

    const snapSprite = snap.m_sprite;
    if (snapSprite)
      this.m_icon.activate(snapSprite, viewport, crossPt, 0);
  }

  private static adjustIconLocation(vp: Viewport, input: Point3d, iconSize: XAndY): Point3d {
    const out = vp.worldToView(input);
    out.x += (iconSize.x / 3.0);
    out.y -= (iconSize.y * 1.3);
    return vp.viewToWorld(out, out);
  }

  /** try to indicate what's wrong with the current point (why we're not snapping). */
  private showSnapError(status: SnapStatus, ev: BeButtonEvent) {
    this.m_errorIcon.deactivate();

    let errorSprite: Sprite | undefined;
    switch (status) {
      case SnapStatus.FilteredByUser:
      case SnapStatus.FilteredByApp:
        errorSprite = s_appFiltered;
        break;

      case SnapStatus.FilteredByAppQuietly:
        this.m_errorReason = LocateFailureValue.LOCATE_FAILURE_None;
        break;

      case SnapStatus.NotSnappable:
        errorSprite = s_notSnappable;
        this.m_errorReason = LocateFailureValue.LOCATE_FAILURE_NotSnappable;
        break;

      case SnapStatus.ModelNotSnappable:
        errorSprite = s_notSnappable;
        this.m_errorReason = LocateFailureValue.LOCATE_FAILURE_ModelNotAllowed;
        break;
    }

    if (!errorSprite)
      return;

    const vp = ev.viewport!;
    const spriteSize = errorSprite.getSize();
    const pt = AccuSnap.adjustIconLocation(vp, ev.rawPoint, spriteSize);

    if (this.wantShowIcon())
      this.m_errorIcon.activate(errorSprite, vp, pt, 0);
  }

  private clearSprites() {
    this.m_errorIcon.deactivate();
    this.m_cross.deactivate();
    this.m_icon.deactivate();
  }

  /** determine whether a hit should be hilited or not. */
  private hitShouldBeHilited(hit?: HitDetail): boolean {
    if (!hit) // || hit->IsHilited())
      return false;

    const snap = AccuSnap.toSnapDetail(hit);
    if (!snap) // always hilite hit paths that aren't snap paths
      return true;

    return snap.isHot() || this.wantHiliteColdHits();
  }

  private unFlashViews() {
    this.m_needFlash.clear();
    this.m_areFlashed.forEach((vp) => {
      // m_eventHandlers.CallAllHandlers(UnFlashCaller(vp.get()));
      vp.setFlashed(undefined, 0.0);
    });
    this.m_areFlashed.clear();
  }

  private onEnabledStateChange(isEnabled: boolean, wasEnabled: boolean) {
    if (isEnabled === wasEnabled) {
      toolAdmin.onAccuSnapSyncUI(); // still need to sync accusnap global setting even if we are not changing the actual state for the current tool.
      return;
    }

    if (isEnabled)
      toolAdmin.onAccuSnapEnabled();
    else
      toolAdmin.onAccuSnapDisabled();
  }

  private initCmdState() { this.m_toolstate.m_suspended = 0; }

  public suspend(doSuspend: boolean) {
    const previousDoSnapping = this.doSnapping();
    if (doSuspend)
      this.m_toolstate.m_suspended++;
    else if (this.m_toolstate.m_suspended > 0)
      this.m_toolstate.m_suspended--;

    this.onEnabledStateChange(this.doSnapping(), previousDoSnapping);
  }

  public suppress(doSuppress: boolean): number {
    const previousDoSnapping = this.doSnapping();
    if (doSuppress)
      this.m_suppressed++;
    else if (this.m_suppressed > 0)
      this.m_suppressed--;

    this.onEnabledStateChange(this.doSnapping(), previousDoSnapping);
    return this.m_suppressed;
  }

  private enableSnap(yesNo: boolean) {
    const previousDoSnapping = this.doSnapping();
    this.m_toolstate.m_enabled = yesNo;
    if (!yesNo) this.clear();
    this.onEnabledStateChange(this.doSnapping(), previousDoSnapping);
  }

  private getNextAccuSnappable(hitList: HitList): HitDetail | undefined {
    const thisPath = hitList.getNextHit();
    if (!!thisPath)
      this.m_explanation = "";
    return thisPath;
  }

  private hitToSnap(hit: HitDetail): SnapDetail | undefined {
    // NEEDS_WORK
    // return m_snapContext.SnapToPath(snap, hit, GetSnapMode(), ElementLocateManager:: GetManager().GetKeypointDivisor(), hit -> GetViewport().PixelsFromInches(GetHotDistanceInches()));
    return undefined;
  }

  private getAccuSnapDetail(hitList: HitList, out?: LocateResponse): SnapDetail | undefined {
    let bestDist = 1e200;
    let bestSnap: SnapDetail | undefined;
    let bestHit: HitDetail | undefined;

    for (let thisHit; undefined !== (thisHit = this.getNextAccuSnappable(hitList)); out = undefined) {
      // if there are multiple hits at the same dist, then find the best snap from all of them. Otherwise, the snap
      // from the first one is the one we want.
      if (bestHit && 0 !== hitList.compare(thisHit, bestHit, true, true))
        break;

      const thisSnap = this.hitToSnap(thisHit);
      if (!thisSnap)
        continue;

      // Pass the snap path instead of the hit path in case a filter modifies the path contents.
      let filtered = false;
      if (this.doLocateTesting())
        filtered = elementLocateManager.filterHit(thisSnap, this.m_toolstate.m_subSelectionMode, LocateAction.AutoLocate, out);

      const thisDist = thisSnap.m_geomDetail.m_viewDist;
      if (!filtered && !(bestSnap && (thisDist >= bestDist))) {
        bestHit = thisHit;
        bestSnap = thisSnap;
        bestDist = thisDist;
      }
    }

    if (bestHit) {
      hitList.setCurrentHit(bestHit);
      return bestSnap;
    }

    return undefined;
  }

  private enableLocate(yesNo: boolean) {
    this.m_toolstate.m_locate = yesNo;
    this.m_toolstate.m_subSelectionMode = SubSelectionMode.None;
  }

  public onStartTool(): void {
    this.initCmdState();
    this.enableSnap(false);
    this.enableLocate(false);
    tentativePoint.clear(true);
  }
}

export class TentativeOrAccuSnap {
  public static isHot(): boolean { return accuSnap.isHot() || tentativePoint.isSnapped(); }

  public static getCurrentSnap(checkIsHot: boolean = true): SnapDetail | undefined {
    // Checking for a hot AccuSnap hit before checking tentative is probably necessary for extended intersections?
    if (accuSnap.isHot())
      return accuSnap.getCurrSnapDetail();

    if (tentativePoint.isSnapped())
      return tentativePoint.m_currSnap;

    return (checkIsHot ? undefined : accuSnap.getCurrSnapDetail());
  }

  public static getCurrentPoint(): Point3d {
    if (accuSnap.isHot()) {
      const pathP = accuSnap.getCurrSnapDetail();
      if (pathP)
        return pathP.getAdjustedPoint();
    }

    return tentativePoint.getPoint();
  }

  public static getCurrentView(): Viewport | undefined {
    const snap = accuSnap.getCurrSnapDetail();
    return snap ? snap.m_viewport : tentativePoint.m_viewport;
  }
}

const toolAdmin = ToolAdmin.instance;
const accuSnap = AccuSnap.instance;
const tentativePoint = TentativePoint.instance;
const viewManager = ViewManager.instance;
const elementLocateManager = ElementLocateManager.instance;
