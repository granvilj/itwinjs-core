/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
/** @packageDocumentation
 * @module iModels
 */

import { GuidString, Id64, Id64String, IModelStatus, OpenMode, Logger } from "@bentley/bentleyjs-core";
import { AxisOrder, Matrix3d, Point3d, Range3dProps, Transform, Vector3d, XYAndZ, XYZProps, YawPitchRollAngles, YawPitchRollProps, Range3d, Angle, AxisIndex } from "@bentley/geometry-core";
import { Cartographic, LatLongAndHeight } from "./geometry/Cartographic";
import { AxisAlignedBox3d } from "./geometry/Placement";
import { IModelError } from "./IModelError";
import { ThumbnailProps } from "./Thumbnail";

/** The properties that identify a specific instance of an iModel for RPC operations.
 * @public
 */
export interface IModelTokenProps {
  /** Key used for identifying the iModel on the backend */
  readonly key: string;
  /** Context (Project, Asset, or other infrastructure) in which the iModel exists - must be defined if the iModel exists in the Hub or in a non-Connect infrastructure. */
  readonly contextId?: GuidString;
  /** Guid of the iModel - must be defined if the iModel exists in the Hub */
  readonly iModelId?: GuidString;
  /** Id of the last ChangeSet that was applied to the iModel - must be defined if the iModel exists in the Hub. An empty string indicates the first version */
  changeSetId?: string;
  /** Mode used to open the iModel */
  openMode?: OpenMode;
}

/** A token that identifies a specific instance of an iModel for RPC operations.
 * @public
 */
export class IModelToken implements IModelTokenProps {
  /** Constructs an IModelToken from a props object. */
  public static fromJSON(props: IModelTokenProps): IModelToken {
    return new IModelToken(props.key, props.contextId, props.iModelId, props.changeSetId, props.openMode);
  }
  /** Key used for identifying the iModel on the backend */
  public readonly key: string;
  /** Context (Project, Asset, or other infrastructure) in which the iModel exists - must be defined if the iModel exists in the Hub or in a non-Connect infrastructure. */
  public readonly contextId?: GuidString;
  /** Guid of the iModel - must be defined if the iModel exists in the Hub */
  public readonly iModelId?: GuidString;
  /** Id of the last ChangeSet that was applied to the iModel - must be defined if the iModel exists in the Hub. An empty string indicates the first version */
  public changeSetId?: string;
  /** Mode used to open the iModel */
  public openMode?: OpenMode;

  /** Constructor */
  public constructor(key: string, contextId?: string, iModelid?: string, changesetId?: string, openMode?: OpenMode) {
    this.key = key;
    this.contextId = contextId;
    this.iModelId = iModelid;
    this.changeSetId = changesetId;
    this.openMode = openMode;
  }

  /** Creates a props object for this IModelToken. */
  public toJSON(): IModelTokenProps {
    return {
      key: this.key,
      contextId: this.contextId,
      iModelId: this.iModelId,
      changeSetId: this.changeSetId,
      openMode: this.openMode,
    };
  }
}

/** Properties that position an iModel on the earth via [ECEF](https://en.wikipedia.org/wiki/ECEF) (Earth Centered Earth Fixed) coordinates
 * @public
 */
export interface EcefLocationProps {
  /** The Origin of an iModel on the earth in ECEF coordinates */
  origin: XYZProps;
  /** The [orientation](https://en.wikipedia.org/wiki/Geographic_coordinate_conversion) of an iModel on the earth. */
  orientation: YawPitchRollProps;
  /** Optional position on the earth used to establish the ECEF coordinates. */
  cartographicOrigin?: LatLongAndHeight;
}

/** The position and orientation of an iModel on the earth in [ECEF](https://en.wikipedia.org/wiki/ECEF) (Earth Centered Earth Fixed) coordinates
 * @see [GeoLocation of iModels]($docs/learning/GeoLocation.md)
 * @public
 */
export class EcefLocation implements EcefLocationProps {
  /** The origin of the ECEF transform. */
  public readonly origin: Point3d;
  /** The orientation of the ECEF transform */
  public readonly orientation: YawPitchRollAngles;
  /** Optional position on the earth used to establish the ECEF origin and orientation. */
  public readonly cartographicOrigin?: Cartographic;
  /** Get the transform from iModel Spatial coordinates to ECEF from this EcefLocation */
  public getTransform(): Transform { return Transform.createOriginAndMatrix(this.origin, this.orientation.toMatrix3d()); }

  /** Construct a new EcefLocation. Once constructed, it is frozen and cannot be modified. */
  constructor(props: EcefLocationProps) {
    this.origin = Point3d.fromJSON(props.origin);
    this.orientation = YawPitchRollAngles.fromJSON(props.orientation);
    this.origin.freeze(); // may not be modified
    this.orientation.freeze(); // may not be modified
    if (props.cartographicOrigin) {
      this.cartographicOrigin = Cartographic.fromRadians(props.cartographicOrigin.longitude, props.cartographicOrigin.latitude, props.cartographicOrigin.height);
      Object.freeze(this.cartographicOrigin); // may not be modified
    }
  }

  /** Construct ECEF Location from cartographic origin with optional known point and angle.   */
  public static createFromCartographicOrigin(origin: Cartographic, point?: Point3d, angle?: Angle) {
    const ecefOrigin = origin.toEcef();
    const zVector = Vector3d.createFrom(ecefOrigin).normalize();
    const xVector = Vector3d.create(-Math.sin(origin.longitude), Math.cos(origin.longitude), 0.0);
    const matrix = Matrix3d.createRigidFromColumns(zVector!, xVector, AxisOrder.ZXY)!;
    if (angle !== undefined) {
      const north = Matrix3d.createRotationAroundAxisIndex(AxisIndex.Z, angle);
      matrix.multiplyMatrixMatrix(north, matrix);
    }
    if (point !== undefined) {
      const delta = matrix.multiplyVector(Vector3d.create(-point.x, -point.y, -point.z));
      ecefOrigin.addInPlace(delta);
    }

    return new EcefLocation({ origin: ecefOrigin, orientation: YawPitchRollAngles.createFromMatrix3d(matrix)!, cartographicOrigin: origin });
  }
  /** Get the location center of the earth in the iModel coordinate system. */
  public get earthCenter(): Point3d {
    const matrix = this.orientation.toMatrix3d();
    return Point3d.createFrom(matrix.multiplyTransposeXYZ(-this.origin.x, -this.origin.y, -this.origin.z));
  }
}

/** Properties of the [Root Subject]($docs/bis/intro/glossary#subject-root).
 * @public
 */
export interface RootSubjectProps {
  /** The name of the root subject. */
  name: string;
  /** Description of the root subject (optional). */
  description?: string;
}

/** Properties that are about an iModel.
 * @public
 */
export interface IModelProps {
  /** The name and description of the root subject of this iModel */
  rootSubject: RootSubjectProps;
  /** The volume of the entire project, in spatial coordinates */
  projectExtents?: Range3dProps;
  /** An offset to be applied to all spatial coordinates. This is normally used to transform spatial coordinates into the Cartesian coordinate system of a Geographic Coordinate System. */
  globalOrigin?: XYZProps;
  /** The location of the iModel in Earth Centered Earth Fixed coordinates. iModel units are always meters */
  ecefLocation?: EcefLocationProps;
  /** The name of the iModel. */
  name?: string;
  /** The token of the iModel. */
  iModelToken?: IModelTokenProps;
}

/** The properties that can be supplied when creating a *new* iModel.
 * @public
 */
export interface CreateIModelProps extends IModelProps {
  /** The GUID of new iModel. If not present, a GUID will be generated. */
  guid?: GuidString;
  /** Client name for new iModel */
  client?: string;
  /** Thumbnail for new iModel
   * @alpha
   */
  thumbnail?: ThumbnailProps;
}

/** Encryption-related properties that can be supplied when creating or opening snapshot iModels.
 * @beta
 */
export interface IModelEncryptionProps {
  /** The password used to encrypt/decrypt the snapshot iModel. */
  password?: string;
}

/** Options that can be supplied when creating snapshot iModels.
 * @beta
 */
export interface CreateSnapshotIModelProps extends IModelEncryptionProps {
  /** If true, then create SQLite views for Model, Element, ElementAspect, and Relationship classes.
   * These database views can often be useful for interoperability workflows.
   */
  createClassViews?: boolean;
}

/** The options that can be specified when creating an *empty* snapshot iModel.
 * @see [SnapshotDb.createEmpty]($backend)
 * @beta
 */
export type CreateEmptySnapshotIModelProps = CreateIModelProps & CreateSnapshotIModelProps;

/** @public */
export interface FilePropertyProps {
  namespace: string;
  name: string;
  id?: number | string;
  subId?: number | string;
}

/** Represents an iModel in JavaScript.
 * @see [GeoLocation of iModels]($docs/learning/GeoLocation.md)
 * @public
 */
export abstract class IModel implements IModelProps {
  /** The Id of the repository model. */
  public static readonly repositoryModelId: Id64String = "0x1";
  /** The Id of the root subject element. */
  public static readonly rootSubjectId: Id64String = "0x1";
  /** The Id of the dictionary model. */
  public static readonly dictionaryId: Id64String = "0x10";
  /** Name of the iModel */
  public name!: string;
  /** The name and description of the root subject of this iModel */
  public rootSubject!: RootSubjectProps;

  /** Returns `true` if this is a snapshot iModel. */
  public abstract get isSnapshot(): boolean;
  /** Returns `true` if this is a briefcase copy of an iModel that is synchronized with iModelHub. */
  public abstract get isBriefcase(): boolean;

  public abstract get isOpen(): boolean;

  private _projectExtents!: AxisAlignedBox3d;
  /**
   * The volume, in spatial coordinates, inside which the entire project is contained.
   * @note The object returned from this method is frozen. You *must* make a copy before you do anything that might attempt to modify it.
   */
  public get projectExtents() { return this._projectExtents; }
  public set projectExtents(extents: AxisAlignedBox3d) {
    this._projectExtents = extents.clone();
    this._projectExtents.ensureMinLengths(1.0);  // don't allow any axis of the project extents to be less than 1 meter.
    this._projectExtents.freeze();
  }

  private _globalOrigin!: Point3d;
  /** An offset to be applied to all spatial coordinates. */
  public get globalOrigin(): Point3d { return this._globalOrigin; }
  public set globalOrigin(org: Point3d) { org.freeze(); this._globalOrigin = org; }

  private _ecefLocation?: EcefLocation;
  private _ecefTrans?: Transform;

  /** The [EcefLocation]($docs/learning/glossary#ecefLocation) of the iModel in Earth Centered Earth Fixed coordinates. */
  public get ecefLocation(): EcefLocation | undefined { return this._ecefLocation; }

  /** Set the [EcefLocation]($docs/learning/glossary#ecefLocation) for this iModel. */
  public setEcefLocation(ecef: EcefLocationProps) {
    this._ecefLocation = new EcefLocation(ecef);
    this._ecefTrans = undefined;
  }

  /** @internal */
  public toJSON(): IModelProps {
    const out: any = {};
    out.name = this.name;
    out.rootSubject = this.rootSubject;
    out.projectExtents = this.projectExtents.toJSON();
    out.globalOrigin = this.globalOrigin.toJSON();
    out.ecefLocation = this.ecefLocation;
    // WIP - add contextId, iModelId, changeSetId?
    out.iModelToken = this.getRpcTokenProps();
    return out;
  }

  /** A key used by RPC operations to identify this iModel across the frontend and backend.
   * @see [[getRpcTokenProps]]
   * @internal
   */
  protected get _rpcKey(): string { return this._token?.key ? this._token.key : ""; } // WIP: this getter will be replaced by a member of the same name once _token is removed
  /** The Guid that identifies the *context* that owns this iModel. */
  public get contextId(): GuidString | undefined { return this._token?.contextId; }
  /** The Guid that identifies this iModel. */
  public get iModelId(): GuidString | undefined { return this._token?.iModelId; }
  /** The Id of the last changeset that was applied to this iModel.
   * @note An empty string indicates the first version while `undefined` mean no changeset information is available.
   */
  public get changeSetId(): string | undefined { return this._token?.changeSetId; }
  /** The [[OpenMode]] used for this IModel. */
  public readonly openMode: OpenMode;

  /**
   * @deprecated use [[getRpcTokenProps]] instead
   * @internal
   */
  protected _token?: IModelToken;

  /** Return a token that can be used to identify this iModel for RPC operations. */
  public getRpcTokenProps(): IModelTokenProps {
    if ((undefined === this._token) || !this.isOpen) {
      throw new IModelError(IModelStatus.BadRequest, "Could not generate valid IModelTokenProps", Logger.logError);
    }
    return {
      key: this._rpcKey,
      contextId: this.contextId,
      iModelId: this.iModelId,
      changeSetId: this.changeSetId,
      openMode: this.openMode,
    };
  }

  /** @internal */
  protected constructor(iModelToken: IModelToken | undefined, openMode: OpenMode) {
    this._token = iModelToken;
    this.openMode = openMode;
  }

  /** @internal */
  protected initialize(name: string, props: IModelProps) {
    this.name = name;
    this.rootSubject = props.rootSubject;
    this.projectExtents = Range3d.fromJSON(props.projectExtents);
    this.globalOrigin = Point3d.fromJSON(props.globalOrigin);
    if (props.ecefLocation)
      this.setEcefLocation(props.ecefLocation);
  }

  /** Get the default subCategoryId for the supplied categoryId */
  public static getDefaultSubCategoryId(categoryId: Id64String): Id64String {
    return Id64.isValid(categoryId) ? Id64.fromLocalAndBriefcaseIds(Id64.getLocalId(categoryId) + 1, Id64.getBriefcaseId(categoryId)) : Id64.invalid;
  }

  /** True if this iModel has an [EcefLocation]($docs/learning/glossary#ecefLocation). */
  public get isGeoLocated() { return undefined !== this._ecefLocation; }

  /** Get the Transform from this iModel's Spatial coordinates to ECEF coordinates using its [[IModel.ecefLocation]].
   * @throws IModelError if [[isGeoLocated]] is false.
   */
  public getEcefTransform(): Transform {
    if (undefined === this._ecefLocation)
      throw new IModelError(IModelStatus.NoGeoLocation, "iModel is not GeoLocated");

    if (this._ecefTrans === undefined) {
      this._ecefTrans = this._ecefLocation.getTransform();
      this._ecefTrans.freeze();
    }

    return this._ecefTrans;
  }

  /** Convert a point in this iModel's Spatial coordinates to an ECEF point using its [[IModel.ecefLocation]].
   * @param spatial A point in the iModel's spatial coordinates
   * @param result If defined, use this for output
   * @returns A Point3d in ECEF coordinates
   * @throws IModelError if [[isGeoLocated]] is false.
   */
  public spatialToEcef(spatial: XYAndZ, result?: Point3d): Point3d { return this.getEcefTransform().multiplyPoint3d(spatial, result)!; }

  /** Convert a point in ECEF coordinates to a point in this iModel's Spatial coordinates using its [[ecefLocation]].
   * @param ecef A point in ECEF coordinates
   * @param result If defined, use this for output
   * @returns A Point3d in this iModel's spatial coordinates
   * @throws IModelError if [[isGeoLocated]] is false.
   * @note The resultant point will only be meaningful if the ECEF coordinate is close on the earth to the iModel.
   */
  public ecefToSpatial(ecef: XYAndZ, result?: Point3d): Point3d { return this.getEcefTransform().multiplyInversePoint3d(ecef, result)!; }

  /** Convert a point in this iModel's Spatial coordinates to a [[Cartographic]] using its [[IModel.ecefLocation]].
   * @param spatial A point in the iModel's spatial coordinates
   * @param result If defined, use this for output
   * @returns A Cartographic location
   * @throws IModelError if [[isGeoLocated]] is false.
   */
  public spatialToCartographicFromEcef(spatial: XYAndZ, result?: Cartographic): Cartographic { return Cartographic.fromEcef(this.spatialToEcef(spatial), result)!; }

  /** Convert a [[Cartographic]] to a point in this iModel's Spatial coordinates using its [[IModel.ecefLocation]].
   * @param cartographic A cartographic location
   * @param result If defined, use this for output
   * @returns A point in this iModel's spatial coordinates
   * @throws IModelError if [[isGeoLocated]] is false.
   * @note The resultant point will only be meaningful if the ECEF coordinate is close on the earth to the iModel.
   */
  public cartographicToSpatialFromEcef(cartographic: Cartographic, result?: Point3d) { return this.ecefToSpatial(cartographic.toEcef(result), result); }
}
