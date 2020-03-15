/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import {
  ClientRequestContext,
  BeEvent,
  DbResult,
  Guid,
  Id64,
  Id64String,
  using,
  Logger,
  LogLevel,
  GetMetaDataFunction,
  GuidString,
} from "@bentley/bentleyjs-core";
import {
  Angle,
  GeometryQuery,
  LineString3d,
  Loop,
  Matrix4d,
  Point3d,
  Range3d,
  Transform,
  StrokeOptions,
  PolyfaceBuilder,
  YawPitchRollAngles,
} from "@bentley/geometry-core";
import { AccessToken, IAuthorizationClient } from "@bentley/imodeljs-clients";
import {
  AxisAlignedBox3d, Code, CodeScopeSpec, CodeSpec, ColorByName, ElementProps, EntityMetaData, EntityProps, FilePropertyProps, FontMap,
  FontType, GeometricElementProps, IModel, IModelError, IModelStatus, PrimitiveTypeCode, RelatedElement, SubCategoryAppearance,
  ViewDefinitionProps, DisplayStyleSettingsProps, ColorDef, ViewFlags, RenderMode, DisplayStyleProps, BisCodeSpec, ImageSourceFormat,
  TextureFlags, TextureMapping, TextureMapProps, TextureMapUnits, GeometryStreamBuilder, GeometricElement3dProps, GeometryParams,
  SpatialViewDefinitionProps, ModelProps,
} from "@bentley/imodeljs-common";
import { assert, expect } from "chai";
import * as path from "path";
import {
  AutoPush, AutoPushParams, AutoPushEventHandler, AutoPushEventType, AutoPushState, BisCoreSchema, Category, ClassRegistry, DefinitionModel, DefinitionPartition,
  DictionaryModel, DocumentPartition, DrawingGraphic, ECSqlStatement, Element, ElementGroupsMembers, ElementOwnsChildElements, Entity,
  GeometricElement2d, GeometricElement3d, GeometricModel, GroupInformationPartition, IModelDb, IModelHost, IModelJsFs, InformationPartitionElement,
  LightLocation, LinkPartition, Model, PhysicalModel, PhysicalPartition, RenderMaterialElement, SpatialCategory, SqliteStatement, SqliteValue,
  SqliteValueType, SubCategory, Subject, Texture, ViewDefinition, DisplayStyle3d, ElementDrivesElement, PhysicalObject, BackendRequestContext, BriefcaseId, SnapshotIModelDb,
} from "../../imodeljs-backend";
import { DisableNativeAssertions, IModelTestUtils } from "../IModelTestUtils";
import { KnownTestLocations } from "../KnownTestLocations";

let lastPushTimeMillis = 0;
let lastAutoPushEventType: AutoPushEventType | undefined;

// spell-checker: disable

async function getIModelError<T>(promise: Promise<T>): Promise<IModelError | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err instanceof IModelError ? err : undefined;
  }
}

function expectIModelError(expectedErrorNumber: IModelStatus, error: IModelError | undefined): void {
  expect(error).not.to.be.undefined;
  expect(error).instanceof(IModelError);
  expect(error!.errorNumber).to.equal(expectedErrorNumber);
}

function exerciseGc() {
  for (let i = 0; i < 1000; ++i) {
    const obj = { value: i };
    const fmt = obj.value.toString();
    assert.isTrue(i === parseInt(fmt, 10));
  }
}

describe("iModel", () => {
  let imodel1: SnapshotIModelDb;
  let imodel2: SnapshotIModelDb;
  let imodel3: SnapshotIModelDb;
  let imodel4: SnapshotIModelDb;
  let imodel5: SnapshotIModelDb;
  const requestContext = new BackendRequestContext();

  before(async () => {
    IModelTestUtils.registerTestBimSchema();
    imodel1 = IModelTestUtils.createSnapshotFromSeed(IModelTestUtils.prepareOutputFile("IModel", "test.bim"), IModelTestUtils.resolveAssetFile("test.bim"));
    imodel2 = IModelTestUtils.createSnapshotFromSeed(IModelTestUtils.prepareOutputFile("IModel", "CompatibilityTestSeed.bim"), IModelTestUtils.resolveAssetFile("CompatibilityTestSeed.bim"));
    imodel3 = SnapshotIModelDb.open(IModelTestUtils.resolveAssetFile("GetSetAutoHandledStructProperties.bim"));
    imodel4 = IModelTestUtils.createSnapshotFromSeed(IModelTestUtils.prepareOutputFile("IModel", "GetSetAutoHandledArrayProperties.bim"), IModelTestUtils.resolveAssetFile("GetSetAutoHandledArrayProperties.bim"));
    imodel5 = IModelTestUtils.createSnapshotFromSeed(IModelTestUtils.prepareOutputFile("IModel", "mirukuru.ibim"), IModelTestUtils.resolveAssetFile("mirukuru.ibim"));

    const schemaPathname = path.join(KnownTestLocations.assetsDir, "TestBim.ecschema.xml");
    await imodel1.importSchemas(requestContext, [schemaPathname]); // will throw an exception if import fails
  });

  after(() => {
    imodel1.close();
    imodel2.close();
    imodel3.close();
    imodel4.close();
    imodel5.close();
  });

  /** Roundtrip the entity through a json string and back to a new entity. */
  const roundtripThroughJson = (entity1: Entity): Entity => {
    const string1 = JSON.stringify(entity1);
    const props1 = JSON.parse(string1) as EntityProps;
    const entity2 = new (entity1.constructor as any)(props1, entity1.iModel); // create a new entity from the EntityProps
    const string2 = JSON.stringify(entity2);
    assert.equal(string1, string2);
    return entity2;
  };

  it("should verify object vault", () => {
    const platform = IModelHost.platform!;

    const o1 = "o1";
    platform.storeObjectInVault({ thisIs: "obj1" }, o1);
    exerciseGc();
    assert.deepEqual(platform.getObjectFromVault(o1), { thisIs: "obj1" });
    assert.equal(platform.getObjectRefCountFromVault(o1), 1);

    const o2 = "o2";
    platform.storeObjectInVault({ thatIs: "obj2" }, o2);
    exerciseGc();
    assert.deepEqual(platform.getObjectFromVault(o2), { thatIs: "obj2" });
    exerciseGc();
    assert.equal(platform.getObjectRefCountFromVault(o2), 1);

    platform.storeObjectInVault(platform.getObjectFromVault(o1), o1); // this is one way to increase the ref count on obj1
    assert.equal(platform.getObjectRefCountFromVault(o1), 2);
    assert.equal(platform.getObjectRefCountFromVault(o2), 1);

    platform.addReferenceToObjectInVault(o1); // this is the more direct way to increase the ref count to obj1
    assert.equal(platform.getObjectRefCountFromVault(o1), 3);

    platform.dropObjectFromVault(o1); // decrease the ref count on obj1
    platform.dropObjectFromVault(o1); // decrease the ref count on obj1
    assert.equal(platform.getObjectRefCountFromVault(o1), 1);

    exerciseGc();

    platform.dropObjectFromVault(o1); // remove the only remaining reference to obj1
    try {
      platform.getObjectFromVault(o1);
    } catch (_err) {
      // expected
    }
    try {
      platform.dropObjectFromVault(o1); // this is ID is invalid and should be rejected.
    } catch (_err) {
      // expected
    }

    assert.equal(platform.getObjectRefCountFromVault(o2), 1);
    assert.deepEqual(platform.getObjectFromVault(o2), { thatIs: "obj2" });
    platform.dropObjectFromVault(o2); // remove the only reference to obj2
    try {
      platform.getObjectFromVault(o2);
    } catch (_err) {
      // expected
    }
  });

  it("should do logging from worker threads in correct context", async () => {

    const contextForTest = new ClientRequestContext("contextForTest");
    const contextForStepAsync = new ClientRequestContext("contextForStepAsync");

    const testMessage = "message from test in main";

    const expectedMsgsInOrder: any[] = [
      { message: "ECSqlStepWorker: Start on main thread", ctx: contextForStepAsync },
      { message: testMessage, ctx: contextForTest },
      { message: "ECSqlStepWorker: In worker thread", ctx: contextForStepAsync },
      { message: "ECSqlStepWorker: Back on main thread", ctx: contextForStepAsync },
    ];

    const msgs: any[] = [];
    Logger.initialize((_category: string, message: string, _metaData?: GetMetaDataFunction) => {
      msgs.push({ message, ctx: ClientRequestContext.current });
    });
    Logger.setLevel("ECSqlStepWorkerTestCategory", LogLevel.Error);
    const stmt = imodel1.prepareStatement("SELECT * from bis.Element");

    contextForStepAsync.enter();        // the statement should run entirely in contextForStepAsync
    const stepPromise = stmt.stepAsync();

    contextForTest.enter();             // while the statement runs, the test switches to a new context
    Logger.logError("ECSqlStepWorkerTestCategory", testMessage);

    const res = await stepPromise;      // now the statement completes.
    assert.equal(res, DbResult.BE_SQLITE_ROW);

    assert.strictEqual(ClientRequestContext.current, contextForTest);

    assert.equal(msgs.length, expectedMsgsInOrder.length);
    for (let i = 0; i < msgs.length; ++i) {
      assert.equal(msgs[i].message, expectedMsgsInOrder[i].message);
      assert.strictEqual(msgs[i].ctx, expectedMsgsInOrder[i].ctx);
    }

    stmt.dispose();
  });

  it("should be able to get properties of an iIModel", () => {
    expect(imodel1.name).equals("TBD"); // That's the name of the root subject!
    const extents: AxisAlignedBox3d = imodel1.projectExtents;
    assert(!extents.isNull);

    // make sure we can construct a new element even if we haven't loaded its metadata (will be loaded in ctor)
    assert.isUndefined(imodel1.classMetaDataRegistry.find("biscore:lightlocation"));
    const e1 = new LightLocation({ category: "0x11", classFullName: "BisCore.LightLocation", model: "0x01", code: Code.createEmpty() }, imodel1);
    assert.isDefined(e1);
    assert.isDefined(imodel1.classMetaDataRegistry.find("biscore:lightlocation")); // should have been loaded in ctor
  });

  it("should use schema to look up classes by name", () => {
    const elementClass = ClassRegistry.findRegisteredClass(Element.classFullName);
    const categoryClass = ClassRegistry.findRegisteredClass(Category.classFullName);
    assert.isDefined(elementClass);
    assert.isDefined(categoryClass);
    assert.equal(elementClass!.schema, BisCoreSchema);
    assert.equal(categoryClass!.schema, BisCoreSchema);
    assert.equal(elementClass!.className, "Element");
    assert.equal(categoryClass!.className, "Category");
  });

  it("FontMap", () => {
    const fonts1 = imodel1.fontMap;
    assert.equal(fonts1.fonts.size, 4, "font map size should be 4");
    assert.equal(FontType.TrueType, fonts1.getFont(1)!.type, "get font 1 type is TrueType");
    assert.equal("Arial", fonts1.getFont(1)!.name, "get Font 1 name");
    assert.equal(1, fonts1.getFont("Arial")!.id, "get Font 1, by name");
    assert.equal(FontType.Rsc, fonts1.getFont(2)!.type, "get font 2 type is Rsc");
    assert.equal("Font0", fonts1.getFont(2)!.name, "get Font 2 name");
    assert.equal(2, fonts1.getFont("Font0")!.id, "get Font 2, by name");
    assert.equal(FontType.Shx, fonts1.getFont(3)!.type, "get font 1 type is Shx");
    assert.equal("ShxFont0", fonts1.getFont(3)!.name, "get Font 3 name");
    assert.equal(3, fonts1.getFont("ShxFont0")!.id, "get Font 3, by name");
    assert.equal(FontType.TrueType, fonts1.getFont(4)!.type, "get font 4 type is TrueType");
    assert.equal("Calibri", fonts1.getFont(4)!.name, "get Font 4 name");
    assert.equal(4, fonts1.getFont("Calibri")!.id, "get Font 3, by name");
    assert.isUndefined(fonts1.getFont("notfound"), "attempt lookup of a font that should not be found");
    assert.deepEqual(new FontMap(fonts1.toJSON()), fonts1, "toJSON on FontMap");
  });

  it("should load a known element by Id from an existing iModel", () => {
    assert.exists(imodel1.elements);
    const code1 = new Code({ spec: "0x10", scope: "0x11", value: "RF1.dgn" });
    const el = imodel1.elements.getElement(code1);
    assert.exists(el);
    const el2ById = imodel1.elements.getElement("0x34");
    assert.exists(el2ById);
    const badCode = new Code({ spec: "0x10", scope: "0x11", value: "RF1_does_not_exist.dgn" });

    try {
      imodel1.elements.getElement(badCode); // throws Error
      assert.fail(); // this line should be skipped
    } catch (error) {
      assert.instanceOf(error, Error);
      assert.instanceOf(error, IModelError);
      assert.equal(error.errorNumber, IModelStatus.NotFound);
    }

    const element1: Element | undefined = imodel1.elements.tryGetElement(code1);
    const element2: Element | undefined = imodel1.elements.tryGetElement("0x34");
    const element3: Element | undefined = imodel1.elements.tryGetElement(badCode);
    assert.isDefined(element1);
    assert.isDefined(element2);
    assert.isUndefined(element3);
    const elementProps1: ElementProps | undefined = imodel1.elements.tryGetElementProps(code1);
    const elementProps2: ElementProps | undefined = imodel1.elements.tryGetElementProps("0x34");
    const elementProps3: ElementProps | undefined = imodel1.elements.tryGetElementProps(badCode);
    assert.isDefined(elementProps1);
    assert.isDefined(elementProps2);
    assert.isUndefined(elementProps3);

    const model1: Model | undefined = imodel1.models.tryGetModel(IModel.dictionaryId);
    const modelProps1: ModelProps | undefined = imodel1.models.tryGetModelProps(IModel.dictionaryId);
    const subModel1: Model | undefined = imodel1.models.tryGetSubModel(IModel.dictionaryId);
    assert.isDefined(model1);
    assert.isDefined(modelProps1);
    assert.isDefined(subModel1);
    const badModel1: Model | undefined = imodel1.models.tryGetModel(Id64.fromUint32Pair(999, 999));
    const badModelProps1: ModelProps | undefined = imodel1.models.tryGetModelProps(Id64.fromUint32Pair(999, 999));
    const badSubModel1: Model | undefined = imodel1.models.tryGetSubModel(IModel.rootSubjectId);
    const badSubModel2: Model | undefined = imodel1.models.tryGetSubModel(badCode);
    assert.isUndefined(badModel1);
    assert.isUndefined(badModelProps1);
    assert.isUndefined(badSubModel1);
    assert.isUndefined(badSubModel2);

    const subCat = imodel1.elements.getElement("0x2e");
    assert.isTrue(subCat instanceof SubCategory);
    if (subCat instanceof SubCategory) {
      assert.isTrue(subCat.appearance.color.tbgr === 16777215);
      assert.isTrue(subCat.appearance.weight === 2);
      assert.equal(Id64.getLocalId(subCat.id), 46);
      assert.equal(Id64.getBriefcaseId(subCat.id), 0);
      assert.equal(Id64.getLocalId(subCat.code.spec), 30);
      assert.equal(Id64.getBriefcaseId(subCat.code.spec), 0);
      assert.isTrue(subCat.code.scope === "0x2d");
      assert.isTrue(subCat.code.value === "A-Z013-G-Legn");
      roundtripThroughJson(subCat);
    }

    /// Get the parent Category of the subcategory.
    const cat = imodel1.elements.getElement((subCat as SubCategory).getCategoryId());
    assert.isTrue(cat instanceof Category);
    if (cat instanceof Category) {
      assert.equal(Id64.getLocalId(cat.id), 45);
      assert.equal(Id64.getBriefcaseId(cat.id), 0);
      assert.isTrue(cat.description === "Legends, symbols keys");
      assert.equal(Id64.getLocalId(cat.code.spec), 22);
      assert.equal(Id64.getBriefcaseId(cat.code.spec), 0);
      assert.isTrue(cat.code.value === "A-Z013-G-Legn");
      roundtripThroughJson(cat);
    }

    const phys = imodel1.elements.getElement("0x38");
    assert.isTrue(phys instanceof GeometricElement3d);

    const locateMsg = phys.getToolTipMessage();
    assert.isDefined(locateMsg);

    const a2 = imodel2.elements.getElement("0x1d");
    assert.exists(a2);
    assert.isTrue(a2.federationGuid! === "18eb4650-b074-414f-b961-d9cfaa6c8746");
    const el3: Element = imodel2.elements.getElement(a2.federationGuid!);
    assert.exists(el3);
    assert.notEqual(a2, el3);
    assert.equal(a2.id, el3.id);
    roundtripThroughJson(el3);

    const newEl = el3;
    newEl.federationGuid = undefined;
    const newId: Id64String = imodel2.elements.insertElement(newEl);
    assert.isTrue(Id64.isValidId64(newId), "insert worked");
  });

  it("should create elements", () => {
    const seedElement = imodel2.elements.getElement<GeometricElement3d>("0x1d");
    assert.exists(seedElement);
    assert.isTrue(seedElement.federationGuid! === "18eb4650-b074-414f-b961-d9cfaa6c8746");

    for (let i = 0; i < 25; i++) {
      const elementProps: GeometricElementProps = {
        classFullName: "Generic:PhysicalObject",
        model: seedElement.model,
        category: seedElement.category,
        code: Code.createEmpty(),
        federationGuid: Guid.createValue(),
        userLabel: "UserLabel-" + i,
      };

      const element: Element = imodel2.elements.createElement(elementProps);
      element.setUserProperties("performanceTest", { s: "String-" + i, n: i });

      const elementId: Id64String = imodel2.elements.insertElement(element);
      assert.isTrue(Id64.isValidId64(elementId));
    }
  });

  it("should insert a Texture", () => {
    const model = imodel2.models.getModel(IModel.dictionaryId) as DictionaryModel;
    expect(model).not.to.be.undefined;

    // This is an encoded png containing a 3x3 square with white in top left pixel, blue in middle pixel, and green in
    // bottom right pixel.  The rest of the square is red.
    const pngData = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 3, 0, 0, 0, 3, 8, 2, 0, 0, 0, 217, 74, 34, 232, 0, 0, 0, 1, 115, 82, 71, 66, 0, 174, 206, 28, 233, 0, 0, 0, 4, 103, 65, 77, 65, 0, 0, 177, 143, 11, 252, 97, 5, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 14, 195, 0, 0, 14, 195, 1, 199, 111, 168, 100, 0, 0, 0, 24, 73, 68, 65, 84, 24, 87, 99, 248, 15, 4, 12, 12, 64, 4, 198, 64, 46, 132, 5, 162, 254, 51, 0, 0, 195, 90, 10, 246, 127, 175, 154, 145, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

    const testTextureName = "fake texture name";
    const testTextureFormat = ImageSourceFormat.Png;
    const testTextureData = Base64.btoa(String.fromCharCode(...pngData));
    const testTextureWidth = 3;
    const testTextureHeight = 3;
    const testTextureDescription = "empty description";
    const testTextureFlags = TextureFlags.None;

    const textureId = Texture.insert(imodel2, IModel.dictionaryId, testTextureName, testTextureFormat, testTextureData, testTextureWidth, testTextureHeight, testTextureDescription, testTextureFlags);

    const texture = imodel2.elements.getElement<Texture>(textureId);
    assert((texture instanceof Texture) === true, "did not retrieve an instance of Texture");
    expect(texture.format).to.equal(testTextureFormat);
    expect(texture.data).to.equal(testTextureData);
    expect(texture.width).to.equal(testTextureWidth);
    expect(texture.height).to.equal(testTextureHeight);
    expect(texture.description).to.equal(testTextureDescription);
    expect(texture.flags).to.equal(testTextureFlags);
  });

  it("should insert a RenderMaterial", () => {
    const model = imodel2.models.getModel(IModel.dictionaryId) as DictionaryModel;
    expect(model).not.to.be.undefined;

    const testMaterialName = "test material name";
    const testPaletteName = "test palette name";
    const testDescription = "test description";
    const color = [25, 32, 9];
    const specularColor = [99, 255, 1];
    const finish = 0.4;
    const transmit = 0.1;
    const diffuse = 0.24;
    const specular = 0.9;
    const reflect = 0.3;
    const reflectColor = [255, 0, 127];
    const textureMapProps: TextureMapProps = {
      pattern_angle: 3.0,
      pattern_u_flip: false,
      pattern_flip: false,
      pattern_scale: [1.0, 1.0],
      pattern_offset: [0.0, 0.0],
      pattern_scalemode: TextureMapUnits.Inches,
      pattern_mapping: TextureMapping.Mode.Planar,
      pattern_weight: 0.5,
      TextureId: "test_textureid",
    };

    const renderMaterialParams = new RenderMaterialElement.Params(testPaletteName);
    renderMaterialParams.description = testDescription;
    renderMaterialParams.color = color;
    renderMaterialParams.specularColor = specularColor;
    renderMaterialParams.finish = finish;
    renderMaterialParams.transmit = transmit;
    renderMaterialParams.diffuse = diffuse;
    renderMaterialParams.specular = specular;
    renderMaterialParams.reflect = reflect;
    renderMaterialParams.reflectColor = reflectColor;
    renderMaterialParams.patternMap = textureMapProps;
    const renderMaterialId = RenderMaterialElement.insert(imodel2, IModel.dictionaryId, testMaterialName, renderMaterialParams);

    const renderMaterial = imodel2.elements.getElement<RenderMaterialElement>(renderMaterialId);
    assert((renderMaterial instanceof RenderMaterialElement) === true, "did not retrieve an instance of RenderMaterial");
    expect(renderMaterial.paletteName).to.equal(testPaletteName);
    expect(renderMaterial.description).to.equal(testDescription);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasBaseColor).to.equal(true);
    expect(JSON.stringify(renderMaterial.jsonProperties.materialAssets.renderMaterial.color)).to.equal(JSON.stringify(color));
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasSpecularColor).to.equal(true);
    expect(JSON.stringify(renderMaterial.jsonProperties.materialAssets.renderMaterial.specular_color)).to.equal(JSON.stringify(specularColor));
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasFinish).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.finish).to.equal(finish);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasTransmit).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.transmit).to.equal(transmit);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasDiffuse).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.diffuse).to.equal(diffuse);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasSpecular).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.specular).to.equal(specular);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasReflect).to.equal(true);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.reflect).to.equal(reflect);
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.HasReflectColor).to.equal(true);
    expect(JSON.stringify(renderMaterial.jsonProperties.materialAssets.renderMaterial.reflect_color)).to.equal(JSON.stringify(reflectColor));
    expect(renderMaterial.jsonProperties.materialAssets.renderMaterial.Map).not.to.be.undefined;

    const patternMap = renderMaterial.jsonProperties.materialAssets.renderMaterial.Map.Pattern;
    expect(patternMap).not.to.be.undefined;
    expect(patternMap.pattern_angle).to.equal(textureMapProps.pattern_angle);
    expect(patternMap.pattern_u_flip).to.equal(textureMapProps.pattern_u_flip);
    expect(patternMap.pattern_flip).to.equal(textureMapProps.pattern_flip);
    expect(JSON.stringify(patternMap.pattern_scale)).to.equal(JSON.stringify(textureMapProps.pattern_scale));
    expect(JSON.stringify(patternMap.pattern_offset)).to.equal(JSON.stringify(textureMapProps.pattern_offset));
    expect(patternMap.pattern_scalemode).to.equal(textureMapProps.pattern_scalemode);
    expect(patternMap.pattern_mapping).to.equal(textureMapProps.pattern_mapping);
    expect(patternMap.pattern_weight).to.equal(textureMapProps.pattern_weight);
    expect(patternMap.TextureId).to.equal(textureMapProps.TextureId);
  });

  it.skip("attempt to apply material to new element in imodel5", () => {
    // This is an encoded png containing a 3x3 square with white in top left pixel, blue in middle pixel, and green in
    // bottom right pixel.  The rest of the square is red.
    const pngData = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 3, 0, 0, 0, 3, 8, 2, 0, 0, 0, 217, 74, 34, 232, 0, 0, 0, 1, 115, 82, 71, 66, 0, 174, 206, 28, 233, 0, 0, 0, 4, 103, 65, 77, 65, 0, 0, 177, 143, 11, 252, 97, 5, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 14, 195, 0, 0, 14, 195, 1, 199, 111, 168, 100, 0, 0, 0, 24, 73, 68, 65, 84, 24, 87, 99, 248, 15, 4, 12, 12, 64, 4, 198, 64, 46, 132, 5, 162, 254, 51, 0, 0, 195, 90, 10, 246, 127, 175, 154, 145, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

    const testTextureName = "fake texture name";
    const testTextureFormat = ImageSourceFormat.Png;
    const testTextureData = Base64.btoa(String.fromCharCode(...pngData));
    const testTextureWidth = 3;
    const testTextureHeight = 3;
    const testTextureDescription = "empty description";
    const testTextureFlags = TextureFlags.None;

    const texId = Texture.insert(imodel5, IModel.dictionaryId, testTextureName, testTextureFormat, testTextureData, testTextureWidth, testTextureHeight, testTextureDescription, testTextureFlags);

    const matId = RenderMaterialElement.insert(imodel5, IModel.dictionaryId, "test material name",
      {
        paletteName: "TestPaletteName",
        patternMap: {
          TextureId: texId,
          pattern_offset: [0, 0],
          pattern_scale: [1, 1],
          pattern_scalemode: TextureMapUnits.Relative,
        },
      });

    /** Create a simple flat mesh with 4 points (2x2) */
    const width = imodel5.projectExtents.xLength() * 0.2;
    const height = imodel5.projectExtents.yLength() * 0.2;
    let shape: GeometryQuery;
    const doPolyface = true;
    if (doPolyface) {
      const options = StrokeOptions.createForFacets();
      options.shouldTriangulate = false;
      const builder = PolyfaceBuilder.create(options);

      const quad = [
        Point3d.create(0.0, 0.0, 0.0),
        Point3d.create(width, 0.0, 0.0),
        Point3d.create(width, height, 0.0),
        Point3d.create(0.0, height, 0.0),
      ];

      builder.addQuadFacet(quad);
      shape = builder.claimPolyface();
    } else {
      shape = Loop.create(LineString3d.create([
        Point3d.create(0, 0, 0),
        Point3d.create(width, 0, 0),
        Point3d.create(width, height, 0),
        Point3d.create(0, height, 0),
        Point3d.create(0, 0, 0),
      ]));
    }

    const modelId = PhysicalModel.insert(imodel5, IModelDb.rootSubjectId, "test_render_material_model_name");

    const categoryId = SpatialCategory.insert(imodel5, IModel.dictionaryId, "GeoJSON Feature", { color: ColorDef.white });

    /** generate a geometry stream containing the polyface */
    const gsBuilder = new GeometryStreamBuilder();
    const params = new GeometryParams(categoryId);
    params.materialId = matId;
    gsBuilder.appendGeometryParamsChange(params);
    gsBuilder.appendGeometry(shape);
    const geometry = gsBuilder.geometryStream;
    // geometry[0].material = { materialId: matId };

    /** The [[GeometricElement3dProps]]  */
    const props: GeometricElement3dProps = {
      placement: { origin: imodel5.projectExtents.center, angles: new YawPitchRollAngles() },
      model: modelId,
      code: Code.createEmpty(),
      classFullName: "Generic:PhysicalObject",
      category: categoryId,
      geom: geometry,
    };
    imodel5.elements.insertElement(props);
    imodel5.saveChanges();
  });

  it("should insert a DisplayStyle", () => {
    const model = imodel2.models.getModel(IModel.dictionaryId) as DictionaryModel;
    expect(model).not.to.be.undefined;

    const settings: DisplayStyleSettingsProps = {
      backgroundColor: ColorDef.blue,
      viewflags: ViewFlags.fromJSON({
        renderMode: RenderMode.SolidFill,
      }),
    };

    const props: DisplayStyleProps = {
      classFullName: DisplayStyle3d.classFullName,
      model: IModel.dictionaryId,
      code: { spec: BisCodeSpec.displayStyle, scope: IModel.dictionaryId },
      isPrivate: false,
      jsonProperties: {
        styles: settings,
      },
    };

    const styleId = imodel2.elements.insertElement(props);
    let style = imodel2.elements.getElement<DisplayStyle3d>(styleId);
    expect(style instanceof DisplayStyle3d).to.be.true;

    expect(style.settings.viewFlags.renderMode).to.equal(RenderMode.SolidFill);
    expect(style.settings.backgroundColor.equals(ColorDef.blue)).to.be.true;

    const newFlags = style.settings.viewFlags.clone();
    newFlags.renderMode = RenderMode.SmoothShade;
    style.settings.viewFlags = newFlags;
    style.settings.backgroundColor = ColorDef.red;
    style.settings.monochromeColor = ColorDef.green;
    expect(style.jsonProperties.styles.viewflags.renderMode).to.equal(RenderMode.SmoothShade);

    imodel2.elements.updateElement(style.toJSON());
    style = imodel2.elements.getElement<DisplayStyle3d>(styleId);
    expect(style instanceof DisplayStyle3d).to.be.true;

    expect(style.settings.viewFlags.renderMode).to.equal(RenderMode.SmoothShade);
    expect(style.settings.backgroundColor.equals(ColorDef.red)).to.be.true;
    expect(style.settings.monochromeColor.equals(ColorDef.green)).to.be.true;
  });

  it("should have a valid root subject element", () => {
    const rootSubject = imodel1.elements.getRootSubject();
    assert.exists(rootSubject);
    assert.isTrue(rootSubject instanceof Subject);
    assert.isAtLeast(rootSubject.code.getValue().length, 1);
    assert.isFalse(imodel1.elements.hasSubModel(IModel.rootSubjectId));

    try {
      imodel1.models.getSubModel(rootSubject.id); // throws error
      assert.fail(); // this line should be skipped
    } catch (error) {
      assert.isTrue(error instanceof Error);
      assert.isTrue(error instanceof IModelError);
      assert.equal(error.errorNumber, IModelStatus.NotFound);
    }

    const childIds: Id64String[] = imodel1.elements.queryChildren(rootSubject.id);
    assert.isAtLeast(childIds.length, 1);
    for (const childId of childIds) {
      const childElement = imodel1.elements.getElement(childId);
      assert.exists(childElement);
      assert.isTrue(childElement instanceof Element);

      roundtripThroughJson(childElement);
      assert.equal(rootSubject.id, childElement.parent!.id);

      const childLocalId = Id64.getLocalId(childId);
      const childBcId = Id64.getBriefcaseId(childId);
      if (childElement instanceof InformationPartitionElement) {
        assert.isTrue(imodel1.elements.hasSubModel(childElement.id));
        const childSubModel: Model = imodel1.models.getSubModel(childElement.id);
        assert.exists(childSubModel, "InformationPartitionElements should have a subModel");

        if (childLocalId === 16 && childBcId === 0) {
          assert.isTrue(childElement instanceof DefinitionPartition, "ChildId 0x00000010 should be a DefinitionPartition");
          assert.isTrue(childElement.code.value === "BisCore.DictionaryModel", "Definition Partition should have code value of BisCore.DictionaryModel");
        } else if (childLocalId === 14 && childBcId === 0) {
          assert.isTrue(childElement instanceof LinkPartition);
          assert.isTrue(childElement.code.value === "BisCore.RealityDataSources");
        } else if (childLocalId === 17 && childBcId === 0) {
          assert.isTrue(childElement instanceof LinkPartition, "ChildId 0x000000011 should be a LinkPartition");
          assert.isTrue(childElement.code.value === "Repository Links");
        }
      } else if (childElement instanceof Subject) {
        assert.isFalse(imodel1.elements.hasSubModel(childElement.id));
        if (childLocalId === 19 && childBcId === 0) {
          assert.isTrue(childElement instanceof Subject);
          assert.isTrue(childElement.code.value === "DgnV8:mf3, A", "Subject should have code value of DgnV8:mf3, A");
          assert.isTrue(childElement.jsonProperties.Subject.Job.DgnV8.V8File === "mf3.dgn", "Subject should have jsonProperty Subject.Job.DgnV.V8File");
          assert.isTrue(childElement.jsonProperties.Subject.Job.DgnV8.V8RootModel === "A", "Subject should have jsonProperty Subject.Job.DgnV.V8RootModel");
        }
      }
    }
  });

  it("should load a known model by Id from an existing iModel", () => {
    assert.exists(imodel1.models);
    const model2 = imodel1.models.getModel("0x1c");
    assert.exists(model2);
    const formatter = model2.getJsonProperty("formatter");
    assert.exists(formatter, "formatter should exist as json property");
    assert.equal(formatter.fmtFlags.angMode, 1, "fmtFlags");
    assert.equal(formatter.mastUnit.label, "m", "mastUnit is meters");
    roundtripThroughJson(model2);
    let model = imodel1.models.getModel(IModel.repositoryModelId);
    assert.exists(model);
    roundtripThroughJson(model!);
    const code1 = new Code({ spec: "0x1d", scope: "0x1d", value: "A" });
    model = imodel1.models.getSubModel(code1);
    // By this point, we expect the submodel's class to be in the class registry *cache*
    const geomModel = ClassRegistry.getClass(PhysicalModel.classFullName, imodel1);
    assert.exists(model);
    assert.isTrue(model instanceof geomModel!);
    roundtripThroughJson(model!);
    const modelExtents: AxisAlignedBox3d = (model as PhysicalModel).queryExtents();
    assert.isBelow(modelExtents.low.x, modelExtents.high.x);
    assert.isBelow(modelExtents.low.y, modelExtents.high.y);
    assert.isBelow(modelExtents.low.z, modelExtents.high.z);
  });

  it("should find a tile tree for a geometric model", async () => {
    // Note: this is an empty model.
    const requestContext2 = new BackendRequestContext();
    const tree = await imodel1.tiles.requestTileTreeProps(requestContext2, "0x1c");
    expect(tree).not.to.be.undefined;

    expect(tree.id).to.equal("0x1c");
    expect(tree.maxTilesToSkip).to.equal(1);
    expect(tree.rootTile).not.to.be.undefined;

    // Empty model => identity transform
    const tf = Transform.fromJSON(tree.location);
    expect(tf.matrix.isIdentity).to.be.true;
    expect(tf.origin.x).to.equal(0);
    expect(tf.origin.y).to.equal(0);
    expect(tf.origin.z).to.equal(0);

    expect(tree.rootTile.contentId).to.equal("0/0/0/0/1");

    // Empty model => null range
    const range = Range3d.fromJSON(tree.rootTile.range);
    expect(range.isNull).to.be.true;

    expect(tree.rootTile.maximumSize).to.equal(0.0); // empty model => undisplayable root tile => size = 0.0
    expect(tree.rootTile.isLeaf).to.be.true; // empty model => empty tile
    expect(tree.rootTile.contentRange).to.be.undefined;
  });

  it("should throw on invalid tile requests", async () => {
    const requestContext2 = new ClientRequestContext("invalidTileRequests");
    await using(new DisableNativeAssertions(), async (_r) => {
      let error = await getIModelError(imodel1.tiles.requestTileTreeProps(requestContext2, "0x12345"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileTreeProps(requestContext2, "NotAValidId"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileContent(requestContext2, "0x1c", "0/0/0/0"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileContent(requestContext2, "0x12345", "0/0/0/0/1"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileContent(requestContext2, "0x1c", "V/W/X/Y/Z"));
      expectIModelError(IModelStatus.InvalidId, error);

      error = await getIModelError(imodel1.tiles.requestTileContent(requestContext2, "0x1c", "NotAValidId"));
      expectIModelError(IModelStatus.InvalidId, error);
    });
  });

  // NOTE: this test can be removed when the deprecated executeQuery method is removed
  it("should produce an array of rows", () => {
    const rows: any[] = IModelTestUtils.executeQuery(imodel1, `SELECT * FROM ${Category.classFullName}`); // tslint:disable-line: deprecation
    assert.exists(rows);
    assert.isArray(rows);
    assert.isAtLeast(rows.length, 1);
    assert.exists(rows[0].id);
    assert.notEqual(rows[0].id.value, "");
  });

  it("should be some categories", () => {
    const categorySql = `SELECT ECInstanceId FROM ${Category.classFullName}`;
    imodel1.withPreparedStatement(categorySql, (categoryStatement: ECSqlStatement): void => {
      let numCategories = 0;
      while (DbResult.BE_SQLITE_ROW === categoryStatement.step()) {
        numCategories++;
        const categoryId: Id64String = categoryStatement.getValue(0).getId();
        const category: Element = imodel1.elements.getElement(categoryId);
        assert.isTrue(category instanceof Category, "Should be instance of Category");

        // verify the default subcategory.
        const defaultSubCategoryId: Id64String = (category as Category).myDefaultSubCategoryId();
        const defaultSubCategory: Element = imodel1.elements.getElement(defaultSubCategoryId);
        assert.isTrue(defaultSubCategory instanceof SubCategory, "defaultSubCategory should be instance of SubCategory");
        if (defaultSubCategory instanceof SubCategory) {
          assert.isTrue(defaultSubCategory.parent!.id === categoryId, "defaultSubCategory id should be prescribed value");
          assert.isTrue(defaultSubCategory.getSubCategoryName() === category.code.getValue(), "DefaultSubcategory name should match that of Category");
          assert.isTrue(defaultSubCategory.isDefaultSubCategory, "isDefaultSubCategory should return true");
        }

        // get the subcategories
        const subCategorySql = `SELECT ECInstanceId FROM ${SubCategory.classFullName} WHERE Parent.Id=:parentId`;
        imodel1.withPreparedStatement(subCategorySql, (subCategoryStatement: ECSqlStatement): void => {
          let numSubCategories = 0;
          subCategoryStatement.bindId("parentId", categoryId);
          while (DbResult.BE_SQLITE_ROW === subCategoryStatement.step()) {
            numSubCategories++;
            const subCategoryId: Id64String = subCategoryStatement.getValue(0).getId();
            const subCategory: Element = imodel1.elements.getElement(subCategoryId);
            assert.isTrue(subCategory instanceof SubCategory);
            assert.isTrue(subCategory.parent!.id === categoryId);
          }
          assert.isAtLeast(numSubCategories, 1, "Expected query to find at least one SubCategory");
        });
      }
      assert.isAtLeast(numCategories, 1, "Expected query to find some categories");
    });
  });

  it("should be some 2d elements", () => {
    const sql = `SELECT ECInstanceId FROM ${DrawingGraphic.classFullName}`;
    imodel2.withPreparedStatement(sql, (statement: ECSqlStatement): void => {
      let numDrawingGraphics = 0;
      let found25: boolean = false;
      let found26: boolean = false;
      while (DbResult.BE_SQLITE_ROW === statement.step()) {
        numDrawingGraphics++;
        const drawingGraphicId: Id64String = statement.getValue(0).getId();
        const drawingGraphic = imodel2.elements.getElement<GeometricElement2d>({ id: drawingGraphicId, wantGeometry: true });
        assert.exists(drawingGraphic);
        assert.isTrue(drawingGraphic.className === "DrawingGraphic", "Should be instance of DrawingGraphic");
        assert.isTrue(drawingGraphic instanceof DrawingGraphic, "Is instance of DrawingGraphic");
        assert.isTrue(drawingGraphic instanceof GeometricElement2d, "Is instance of GeometricElement2d");
        if (Id64.getLocalId(drawingGraphic.id) === 0x25) {
          found25 = true;
          assert.isTrue(drawingGraphic.placement.origin.x === 0.0);
          assert.isTrue(drawingGraphic.placement.origin.y === 0.0);
          assert.isTrue(drawingGraphic.placement.angle.radians === 0.0);
          assert.isTrue(drawingGraphic.placement.bbox.low.x === 0.0);
          assert.isTrue(drawingGraphic.placement.bbox.low.y === 0.0);
          assert.isTrue(drawingGraphic.placement.bbox.high.x === 1.0);
          assert.isTrue(drawingGraphic.placement.bbox.high.y === 1.0);
          assert.isDefined(drawingGraphic.geom);
        } else if (Id64.getLocalId(drawingGraphic.id) === 0x26) {
          found26 = true;
          assert.isTrue(drawingGraphic.placement.origin.x === 1.0);
          assert.isTrue(drawingGraphic.placement.origin.y === 1.0);
          assert.isTrue(drawingGraphic.placement.angle.radians === 0.0);
          assert.isTrue(drawingGraphic.placement.bbox.low.x === 0.0);
          assert.isTrue(drawingGraphic.placement.bbox.low.y === 0.0);
          assert.isTrue(drawingGraphic.placement.bbox.high.x === 2.0);
          assert.isTrue(drawingGraphic.placement.bbox.high.y === 2.0);
          assert.isDefined(drawingGraphic.geom);
        }
      }
      assert.isAtLeast(numDrawingGraphics, 1, "Expected query to find some DrawingGraphics");
      assert.isTrue(found25, "Expected to find a specific element");
      assert.isTrue(found26, "Expected to find a specific element");
    });
  });

  it("should be able to query for ViewDefinitionProps", () => {
    const viewDefinitionProps: ViewDefinitionProps[] = imodel2.views.queryViewDefinitionProps(); // query for all ViewDefinitions
    assert.isAtLeast(viewDefinitionProps.length, 3);
    assert.isTrue(viewDefinitionProps[0].classFullName.includes("ViewDefinition"));
    assert.isFalse(viewDefinitionProps[1].isPrivate);
    const spatialViewDefinitionProps = imodel2.views.queryViewDefinitionProps("BisCore.SpatialViewDefinition") as SpatialViewDefinitionProps[]; // limit query to SpatialViewDefinitions
    assert.isAtLeast(spatialViewDefinitionProps.length, 3);
    assert.exists(spatialViewDefinitionProps[2].modelSelectorId);
  });

  it("should iterate ViewDefinitions", () => {
    // imodel2 contains 3 SpatialViewDefinitions and no other views.
    let numViews = 0;
    let result = imodel2.views.iterateViews(IModelDb.Views.defaultQueryParams, (_view: ViewDefinition) => { ++numViews; return true; });
    expect(result).to.be.true;
    expect(numViews).to.equal(3);

    // Query specifically for spatial views
    numViews = 0;
    result = imodel2.views.iterateViews({ from: "BisCore.SpatialViewDefinition" }, (view: ViewDefinition) => {
      if (view.isSpatialView())
        ++numViews;

      return view.isSpatialView();
    });
    expect(result).to.be.true;
    expect(numViews).to.equal(3);

    // Query specifically for 2d views
    numViews = 0;
    result = imodel2.views.iterateViews({ from: "BisCore.ViewDefinition2d" }, (_view: ViewDefinition) => { ++numViews; return true; });
    expect(result).to.be.true;
    expect(numViews).to.equal(0);

    // Terminate iteration on first view
    numViews = 0;
    result = imodel2.views.iterateViews(IModelDb.Views.defaultQueryParams, (_view: ViewDefinition) => { ++numViews; return false; });
    expect(result).to.be.false;
    expect(numViews).to.equal(1);
  });

  it("should be children of RootSubject", () => {
    const sql = `SELECT ECInstanceId FROM ${Model.classFullName} WHERE ParentModel.Id=:parentModelId`;
    imodel2.withPreparedStatement(sql, (statement: ECSqlStatement): void => {
      statement.bindId("parentModelId", IModel.repositoryModelId);
      let numModels = 0;
      while (DbResult.BE_SQLITE_ROW === statement.step()) {
        numModels++;
        const modelId: Id64String = statement.getValue(0).getId();
        const model = imodel2.models.getModel(modelId);
        assert.exists(model, "Model should exist");
        assert.isTrue(model instanceof Model);

        // should be an element with the same Id.
        const modeledElement = imodel2.elements.getElement(modelId);
        assert.exists(modeledElement, "Modeled Element should exist");

        if (model.className === "LinkModel") {
          // expect LinkModel to be accompanied by LinkPartition
          assert.isTrue(modeledElement instanceof LinkPartition);
          continue;
        } else if (model.className === "DictionaryModel") {
          assert.isTrue(modeledElement instanceof DefinitionPartition);
          continue;
        } else if (model.className === "PhysicalModel") {
          assert.isTrue(modeledElement instanceof PhysicalPartition);
          continue;
        } else if (model.className === "GroupModel") {
          assert.isTrue(modeledElement instanceof GroupInformationPartition);
          continue;
        } else if (model.className === "DocumentListModel") {
          assert.isTrue(modeledElement instanceof DocumentPartition);
          continue;
        } else if (model.className === "DefinitionModel") {
          assert.isTrue(modeledElement instanceof DefinitionPartition);
          continue;
        } else {
          assert.isTrue(false, "Expected a known model type");
        }
      }
      assert.isAtLeast(numModels, 1, "Expected query to find some Models");
    });
  });

  it("should insert and update auto-handled properties", () => {
    const testElem = imodel4.elements.getElement("0x14");
    assert.isDefined(testElem);
    assert.equal(testElem.classFullName, "DgnPlatformTest:TestElementWithNoHandler");
    assert.isUndefined(testElem.asAny.integerProperty1);

    const newTestElem = roundtripThroughJson(testElem) as Element;
    assert.equal(newTestElem.classFullName, testElem.classFullName);
    newTestElem.asAny.integerProperty1 = 999;
    assert.isTrue(testElem.asAny.arrayOfPoint3d[0].isAlmostEqual(newTestElem.asAny.arrayOfPoint3d[0]));

    const loc1 = { street: "Elm Street", city: { name: "Downingtown", state: "PA" } };
    const loc2 = { street: "Oak Street", city: { name: "Downingtown", state: "PA" } };
    const loc3 = { street: "Chestnut Street", city: { name: "Philadelphia", state: "PA" } };
    const arrayOfStructs = [loc2, loc3];
    newTestElem.asAny.location = loc1;
    newTestElem.asAny.arrayOfStructs = arrayOfStructs;
    newTestElem.asAny.dtUtc = new Date("2015-03-25");
    newTestElem.asAny.p3d = new Point3d(1, 2, 3);

    const newTestElemId = imodel4.elements.insertElement(newTestElem);

    assert.isTrue(Id64.isValidId64(newTestElemId), "insert worked");

    const newTestElemFetched = imodel4.elements.getElement(newTestElemId);
    assert.isDefined(newTestElemFetched);
    assert.isTrue(newTestElemFetched.id === newTestElemId);
    assert.equal(newTestElemFetched.classFullName, newTestElem.classFullName);
    assert.isDefined(newTestElemFetched.asAny.integerProperty1);
    assert.equal(newTestElemFetched.asAny.integerProperty1, newTestElem.asAny.integerProperty1);
    assert.isTrue(newTestElemFetched.asAny.arrayOfPoint3d[0].isAlmostEqual(newTestElem.asAny.arrayOfPoint3d[0]));
    assert.deepEqual(newTestElemFetched.asAny.location, loc1);
    assert.deepEqual(newTestElem.asAny.arrayOfStructs, arrayOfStructs);
    // TODO: getElement must convert date ISO string to Date object    assert.deepEqual(newTestElemFetched.dtUtc, newTestElem.dtUtc);
    assert.deepEqual(newTestElemFetched.asAny.dtUtc, newTestElem.asAny.dtUtc.toJSON());
    assert.isTrue(newTestElemFetched.asAny.p3d.isAlmostEqual(newTestElem.asAny.p3d));

    // ----------- updates ----------------
    const wasp3d = newTestElemFetched.asAny.p3d;
    const editElem = newTestElemFetched;
    editElem.asAny.location = loc2;
    try {
      imodel4.elements.updateElement(editElem);
    } catch (_err) {
      assert.fail("Element.update failed");
    }
    const afterUpdateElemFetched = imodel4.elements.getElement(editElem.id);
    assert.deepEqual(afterUpdateElemFetched.asAny.location, loc2, " location property should be the new one");
    assert.deepEqual(afterUpdateElemFetched.asAny.id, editElem.id, " the id should not have changed.");
    assert.deepEqual(afterUpdateElemFetched.asAny.p3d, wasp3d, " p3d property should not have changed");

    // Make array shorter
    assert.equal(afterUpdateElemFetched.asAny.arrayOfInt.length, 300);

    afterUpdateElemFetched.asAny.arrayOfInt = [99, 3];
    imodel4.elements.updateElement(afterUpdateElemFetched);

    const afterShortenArray = imodel4.elements.getElement(afterUpdateElemFetched.id);
    assert.equal(afterUpdateElemFetched.asAny.arrayOfInt.length, 2);
    assert.deepEqual(afterShortenArray.asAny.arrayOfInt, [99, 3]);

    // Make array longer
    afterShortenArray.asAny.arrayOfInt = [1, 2, 3];
    imodel4.elements.updateElement(afterShortenArray);
    const afterLengthenArray = imodel4.elements.getElement(afterShortenArray.id);
    assert.equal(afterLengthenArray.asAny.arrayOfInt.length, 3);
    assert.deepEqual(afterLengthenArray.asAny.arrayOfInt, [1, 2, 3]);

    // ------------ delete -----------------
    const elid = afterUpdateElemFetched.id;
    imodel4.elements.deleteElement(elid);
    assert.throws(() => imodel4.elements.getElement(elid), IModelError);
  });

  it("should handle parent and child deletion properly", () => {
    const categoryId = SpatialCategory.insert(imodel4, IModel.dictionaryId, "MyTestCategory", new SubCategoryAppearance());
    const category: SpatialCategory = imodel4.elements.getElement<SpatialCategory>(categoryId);
    const subCategory: SubCategory = imodel4.elements.getElement<SubCategory>(category.myDefaultSubCategoryId());
    assert.throws(() => imodel4.elements.deleteElement(categoryId), IModelError);
    assert.exists(imodel4.elements.getElement(categoryId), "Category deletes should be blocked in native code");
    assert.exists(imodel4.elements.getElement(subCategory.id), "Children should not be deleted if parent delete is blocked");

    const modelId = PhysicalModel.insert(imodel4, IModel.rootSubjectId, "MyTestPhysicalModel");
    const elementProps: GeometricElementProps = {
      classFullName: PhysicalObject.classFullName,
      model: modelId,
      category: categoryId,
      code: Code.createEmpty(),
    };
    const parentId = imodel4.elements.insertElement(elementProps);
    elementProps.parent = new ElementOwnsChildElements(parentId);
    const childId1 = imodel4.elements.insertElement(elementProps);
    const childId2 = imodel4.elements.insertElement(elementProps);
    assert.exists(imodel4.elements.getElement(parentId));
    assert.exists(imodel4.elements.getElement(childId1));
    assert.exists(imodel4.elements.getElement(childId2));
    imodel4.elements.deleteElement(parentId);
    assert.throws(() => imodel4.elements.getElement(parentId), IModelError);
    assert.throws(() => imodel4.elements.getElement(childId1), IModelError);
    assert.throws(() => imodel4.elements.getElement(childId2), IModelError);
  });

  function checkElementMetaData(obj: EntityMetaData) {
    assert.isNotNull(obj);
    assert.equal(obj.ecclass, Element.classFullName);
    assert.isArray(obj.baseClasses);
    assert.equal(obj.baseClasses.length, 0);

    assert.isArray(obj.customAttributes);
    let foundClassHasHandler = false;
    let foundClassHasCurrentTimeStampProperty = false;
    if (obj.customAttributes !== undefined) {
      for (const ca of obj.customAttributes) {
        if (ca.ecclass === "BisCore:ClassHasHandler")
          foundClassHasHandler = true;
        else if (ca.ecclass === "CoreCustomAttributes:ClassHasCurrentTimeStampProperty")
          foundClassHasCurrentTimeStampProperty = true;
      }
    }
    assert.isTrue(foundClassHasHandler);
    assert.isTrue(foundClassHasCurrentTimeStampProperty);
    assert.isDefined(obj.properties.federationGuid);
    assert.equal(obj.properties.federationGuid.primitiveType, 257);
    assert.equal(obj.properties.federationGuid.extendedType, "BeGuid");
  }

  it("should get metadata for class", () => {
    const metaData: EntityMetaData = imodel1.getMetaData(Element.classFullName);
    assert.exists(metaData);
    checkElementMetaData(metaData);
  });

  it("update the project extents", async () => {
    const originalExtents = imodel1.projectExtents;
    const newExtents = Range3d.create(originalExtents.low, originalExtents.high);
    newExtents.low.x -= 50; newExtents.low.y -= 25; newExtents.low.z -= 189;
    newExtents.high.x += 1087; newExtents.high.y += 19; newExtents.high.z += .001;
    imodel1.updateProjectExtents(newExtents);

    const updatedProps = JSON.parse(imodel1.briefcase!.nativeDb.getIModelProps());
    assert.isTrue(updatedProps.hasOwnProperty("projectExtents"), "Returned property JSON object has project extents");
    const updatedExtents = Range3d.fromJSON(updatedProps.projectExtents);
    assert.isTrue(newExtents.isAlmostEqual(updatedExtents), "Project extents successfully updated in database");
  });

  it("read view thumbnail", () => {
    const viewId = "0x24";
    const thumbnail = imodel5.views.getThumbnail(viewId);
    assert.exists(thumbnail);
    if (!thumbnail)
      return;
    assert.equal(thumbnail.format, "jpeg");
    assert.equal(thumbnail.height, 768);
    assert.equal(thumbnail.width, 768);
    assert.equal(thumbnail.image!.length, 18062);

    thumbnail.width = 100;
    thumbnail.height = 200;
    thumbnail.format = "png";
    thumbnail.image = new Uint8Array(200);
    thumbnail.image.fill(12);
    const stat = imodel5.views.saveThumbnail(viewId, thumbnail);
    assert.equal(stat, 0, "save thumbnail");
    const thumbnail2 = imodel5.views.getThumbnail(viewId);
    assert.exists(thumbnail2);
    if (!thumbnail2)
      return;
    assert.equal(thumbnail2.format, "png");
    assert.equal(thumbnail2.height, 200);
    assert.equal(thumbnail2.width, 100);
    assert.equal(thumbnail2.image!.length, 200);
    assert.equal(thumbnail2.image![0], 12);
  });

  it("ecefLocation for iModels", () => {
    assert.isTrue(imodel5.isGeoLocated);
    const center = { x: 289095, y: 3803860, z: 10 }; // near center of project extents, 10 meters above ground.
    const ecefPt = imodel5.spatialToEcef(center);
    const pt = { x: -3575157.057023252, y: 3873432.7966756118, z: 3578994.5664978377 };
    assert.isTrue(ecefPt.isAlmostEqual(pt), "spatialToEcef");

    const z2 = imodel5.ecefToSpatial(ecefPt);
    assert.isTrue(z2.isAlmostEqual(center), "ecefToSpatial");

    const carto = imodel5.spatialToCartographicFromEcef(center);
    assert.approximately(Angle.radiansToDegrees(carto.longitude), 132.70599650539427, .1); // this data is in Japan
    assert.approximately(Angle.radiansToDegrees(carto.latitude), 34.35461328445589, .1);
    const c2 = { longitude: 2.316156576159219, latitude: 0.5996011150631385, height: 10 };
    assert.isTrue(carto.equalsEpsilon(c2, .001), "spatialToCartographic");

    imodel5.cartographicToSpatialFromEcef(carto, z2);
    assert.isTrue(z2.isAlmostEqual(center, .001), "cartographicToSpatial");
  });

  function checkClassHasHandlerMetaData(obj: EntityMetaData) {
    assert.isDefined(obj.properties.restrictions);
    assert.equal(obj.properties.restrictions.primitiveType, 2305);
    assert.equal(obj.properties.restrictions.minOccurs, 0);
  }

  it("should get metadata for CA class just as well (and we'll see a array-typed property)", () => {
    const metaData: EntityMetaData = imodel1.getMetaData("BisCore:ClassHasHandler");
    assert.exists(metaData);
    checkClassHasHandlerMetaData(metaData);
  });

  it("should get metadata for CA class just as well (and we'll see a array-typed property)", () => {
    const metaData: EntityMetaData = imodel1.getMetaData("BisCore:ClassHasHandler");
    assert.exists(metaData);
    checkClassHasHandlerMetaData(metaData);
  });

  it("should exercise ECSqlStatement (backend only)", () => {
    // Reject an invalid statement
    try {
      imodel2.prepareStatement("select no_such_property, codeValue from bis.element");
      assert.fail("prepare should have failed with an exception");
    } catch (err) {
      assert.isTrue(err.constructor.name === "IModelError");
      assert.notEqual(err.status, DbResult.BE_SQLITE_OK);
    }
    let lastId: string = "";
    let firstCodeValue: string = "";
    imodel2.withPreparedStatement("select ecinstanceid, codeValue from bis.element", (stmt: ECSqlStatement) => {
      assert.isNotNull(stmt);
      // Reject an attempt to bind when there are no placeholders in the statement
      try {
        stmt.bindStruct(1, { foo: 1 });
        assert.fail("bindStruct should have failed with an exception");
      } catch (err2) {
        assert.isTrue(err2.constructor.name === "IModelError");
        assert.notEqual(err2.status, DbResult.BE_SQLITE_OK);
      }

      // Verify that we get a bunch of rows with the expected shape
      let count = 0;
      while (DbResult.BE_SQLITE_ROW === stmt.step()) {
        const row = stmt.getRow();
        assert.isNotNull(row);
        assert.isObject(row);
        assert.isTrue(row.id !== undefined);
        assert.isTrue(Id64.isValid(Id64.fromJSON(row.id)));
        lastId = row.id;
        if (row.codeValue !== undefined)
          firstCodeValue = row.codeValue;
        count = count + 1;
      }
      assert.isTrue(count > 1);
      assert.notEqual(lastId, "");
      assert.notEqual(firstCodeValue, "");

      // Try iterator style
      let firstCodeValueIter: string = "";
      let iteratorCount = 0;
      let lastIterId: string = "";
      stmt.reset();
      for (const row of stmt) {
        assert.isNotNull(row);
        assert.isObject(row);
        assert.isTrue(row.id !== undefined);
        assert.isTrue(Id64.isValid(Id64.fromJSON(row.id)));
        lastIterId = row.id;
        iteratorCount = iteratorCount + 1;
        if (row.codeValue !== undefined)
          firstCodeValueIter = row.codeValue;
      }
      assert.equal(iteratorCount, count, "iterator loop should find the same number of rows as the step loop");
      assert.equal(lastIterId, lastId, "iterator loop should see the same last row as the step loop");
      assert.equal(firstCodeValueIter, firstCodeValue, "iterator loop should find the first non-null code value as the step loop");
    });

    imodel2.withPreparedStatement("select ecinstanceid, codeValue from bis.element WHERE (ecinstanceid=?)", (stmt3: ECSqlStatement) => {
      // Now try a statement with a placeholder
      const idToFind: Id64String = Id64.fromJSON(lastId);
      stmt3.bindId(1, idToFind);
      let count = 0;
      while (DbResult.BE_SQLITE_ROW === stmt3.step()) {
        count = count + 1;
        const row = stmt3.getRow();
        // Verify that we got the row that we asked for
        assert.isTrue(idToFind === Id64.fromJSON(row.id));
      }
      // Verify that we got the row that we asked for
      assert.equal(count, 1);
    });

    imodel2.withPreparedStatement("select ecinstanceid, codeValue from bis.element WHERE (codeValue = :codevalue)", (stmt4: ECSqlStatement) => {
      // Try a named placeholder
      const codeValueToFind = firstCodeValue;
      stmt4.bindString("codeValue", codeValueToFind);
      let count = 0;
      while (DbResult.BE_SQLITE_ROW === stmt4.step()) {
        count = count + 1;
        const row = stmt4.getRow();
        // Verify that we got the row that we asked for
        assert.equal(row.codeValue, codeValueToFind);
      }
      // Verify that we got the row that we asked for
      assert.equal(count, 1);
    });

    imodel2.withPreparedStatement("select ecinstanceid as id, codevalue from bis.element", (stmt5: ECSqlStatement) => {
      while (DbResult.BE_SQLITE_ROW === stmt5.step()) {
        imodel2.withPreparedStatement("select codevalue from bis.element where ecinstanceid=?", (stmt6: ECSqlStatement) => {
          stmt6.bindId(1, stmt5.getRow().id);
          while (DbResult.BE_SQLITE_ROW === stmt6.step()) {
            assert.equal(stmt6.getRow().codevalue, stmt5.getRow().codevalue);
          }
        });
      }
    });

  });

  it("validate BisCodeSpecs", async () => {
    assert.equal(imodel2.codeSpecs.getByName(BisCodeSpec.nullCodeSpec).scopeType, CodeScopeSpec.Type.Repository);
    assert.equal(imodel2.codeSpecs.getByName(BisCodeSpec.subCategory).scopeType, CodeScopeSpec.Type.ParentElement);
    assert.equal(imodel2.codeSpecs.getByName(BisCodeSpec.viewDefinition).scopeType, CodeScopeSpec.Type.Model);
    assert.equal(imodel2.codeSpecs.getByName(BisCodeSpec.subject).scopeReq, CodeScopeSpec.ScopeRequirement.ElementId);
    assert.isTrue(imodel2.codeSpecs.getByName(BisCodeSpec.spatialCategory).isManagedWithIModel);
  });

  it("should create and insert CodeSpecs", () => {
    const testImodel = imodel2;
    const codeSpec: CodeSpec = CodeSpec.create(testImodel, "CodeSpec1", CodeScopeSpec.Type.Model);
    const codeSpecId: Id64String = testImodel.codeSpecs.insert(codeSpec); // throws in case of error
    assert.deepEqual(codeSpecId, codeSpec.id);
    assert.equal(codeSpec.scopeType, CodeScopeSpec.Type.Model);
    assert.equal(codeSpec.scopeReq, CodeScopeSpec.ScopeRequirement.ElementId);
    assert.equal(codeSpec.isManagedWithIModel, true);

    // Should not be able to insert a duplicate.
    const codeSpecDup: CodeSpec = CodeSpec.create(testImodel, "CodeSpec1", CodeScopeSpec.Type.Model);
    assert.throws(() => testImodel.codeSpecs.insert(codeSpecDup), IModelError);

    // We should be able to insert another CodeSpec with a different name.
    const codeSpec2: CodeSpec = CodeSpec.create(testImodel, "CodeSpec2", CodeScopeSpec.Type.Model, CodeScopeSpec.ScopeRequirement.FederationGuid);
    const codeSpec2Id: Id64String = testImodel.codeSpecs.insert(codeSpec2); // throws in case of error
    assert.deepEqual(codeSpec2Id, codeSpec2.id);
    assert.notDeepEqual(codeSpec2Id, codeSpecId);

    // make sure CodeScopeSpec.Type.Repository works
    const codeSpec3: CodeSpec = CodeSpec.create(testImodel, "CodeSpec3", CodeScopeSpec.Type.Repository, CodeScopeSpec.ScopeRequirement.FederationGuid);
    const codeSpec3Id: Id64String = testImodel.codeSpecs.insert(codeSpec3); // throws in case of error
    assert.notDeepEqual(codeSpec2Id, codeSpec3Id);

    const codeSpec4: CodeSpec = testImodel.codeSpecs.getById(codeSpec3Id);
    codeSpec4.name = "CodeSpec4";
    codeSpec4.isManagedWithIModel = false;
    const codeSpec4Id: Id64String = testImodel.codeSpecs.insert(codeSpec4); // throws in case of error
    assert.notDeepEqual(codeSpec3Id, codeSpec4Id);
    assert.equal(codeSpec4.scopeType, CodeScopeSpec.Type.Repository);
    assert.equal(codeSpec4.scopeReq, CodeScopeSpec.ScopeRequirement.FederationGuid);
    const copyOfCodeSpec4: CodeSpec = testImodel.codeSpecs.getById(codeSpec4Id);
    assert.equal(copyOfCodeSpec4.isManagedWithIModel, false);
    assert.deepEqual(codeSpec4, copyOfCodeSpec4);

    assert.isTrue(testImodel.codeSpecs.hasName("CodeSpec1"));
    assert.isTrue(testImodel.codeSpecs.hasName("CodeSpec2"));
    assert.isTrue(testImodel.codeSpecs.hasName("CodeSpec3"));
    assert.isTrue(testImodel.codeSpecs.hasName("CodeSpec4"));
    assert.isFalse(testImodel.codeSpecs.hasName("CodeSpec5"));

    assert.isTrue(testImodel.codeSpecs.hasId(codeSpec.id));
    assert.isTrue(testImodel.codeSpecs.hasId(codeSpec2.id));
    assert.isTrue(testImodel.codeSpecs.hasId(codeSpec3.id));
    assert.isTrue(testImodel.codeSpecs.hasId(codeSpec4.id));
    assert.isFalse(testImodel.codeSpecs.hasId(Id64.invalid));
  });

  it("validate CodeSpec properties", async () => {
    const iModelFileName: string = IModelTestUtils.prepareOutputFile("IModel", "ReadWriteCodeSpec.bim");
    const codeSpecName = "CodeSpec1";

    // Write new CodeSpec to iModel
    if (true) {
      const iModelDb: SnapshotIModelDb = IModelTestUtils.createSnapshotFromSeed(iModelFileName, IModelTestUtils.resolveAssetFile("CompatibilityTestSeed.bim"));
      const codeSpec: CodeSpec = CodeSpec.create(iModelDb, codeSpecName, CodeScopeSpec.Type.Model, CodeScopeSpec.ScopeRequirement.FederationGuid);
      codeSpec.isManagedWithIModel = false;
      const codeSpecId: Id64String = iModelDb.codeSpecs.insert(codeSpec);
      assert.isTrue(Id64.isValidId64(codeSpec.id));
      assert.equal(codeSpec.id, codeSpecId);
      assert.equal(codeSpec.name, codeSpecName);
      assert.equal(codeSpec.scopeType, CodeScopeSpec.Type.Model);
      assert.equal(codeSpec.scopeReq, CodeScopeSpec.ScopeRequirement.FederationGuid);
      assert.isFalse(codeSpec.isManagedWithIModel);
      iModelDb.close();
    }

    // Reopen iModel (ensure CodeSpec cache is cleared) and reconfirm CodeSpec properties
    if (true) {
      const iModelDb = SnapshotIModelDb.open(iModelFileName);
      const codeSpec: CodeSpec = iModelDb.codeSpecs.getByName(codeSpecName);
      assert.isTrue(Id64.isValidId64(codeSpec.id));
      assert.equal(codeSpec.name, codeSpecName);
      assert.equal(codeSpec.scopeType, CodeScopeSpec.Type.Model);
      assert.equal(codeSpec.scopeReq, CodeScopeSpec.ScopeRequirement.FederationGuid);
      assert.isFalse(codeSpec.isManagedWithIModel);
      iModelDb.close();
    }
  });

  it("snapping", async () => {
    const worldToView = Matrix4d.createIdentity();
    const response = await imodel2.requestSnap(requestContext, "0x222", { testPoint: { x: 1, y: 2, z: 3 }, closePoint: { x: 1, y: 2, z: 3 }, id: "0x111", worldToView: worldToView.toJSON() });
    assert.isDefined(response.status);
  });

  it("should import schemas", async () => {
    const classMetaData = imodel1.getMetaData("TestBim:TestDocument"); // will throw on failure
    assert.isDefined(classMetaData.properties.testDocumentProperty);
    assert.isTrue(classMetaData.properties.testDocumentProperty.primitiveType === PrimitiveTypeCode.Integer);
  });

  it("should do CRUD on models", () => {

    const testImodel = imodel2;

    let modeledElementId: Id64String;
    let newModelId: Id64String;
    [modeledElementId, newModelId] = IModelTestUtils.createAndInsertPhysicalPartitionAndModel(testImodel, Code.createEmpty(), true);

    const newModelPersist = testImodel.models.getModel(newModelId);

    // Check that it has the properties that we set.
    assert.equal(newModelPersist.classFullName, PhysicalModel.classFullName);
    assert.isTrue(newModelPersist.isPrivate);
    assert.deepEqual(newModelPersist.modeledElement.id, modeledElementId);

    // Update the model
    newModelPersist.isPrivate = false;
    testImodel.models.updateModel(newModelPersist);
    //  ... and check that it updated the model in the db
    const newModelPersist2 = testImodel.models.getModel(newModelId);
    assert.isFalse(newModelPersist2.isPrivate);

    // Delete the model
    testImodel.models.deleteModel(newModelId);

    // Test insertModel error handling
    assert.throws(() => {
      testImodel.models.insertModel({
        classFullName: DefinitionModel.classFullName,
        modeledElement: { id: "0x10000000bad" },
      });
    }, IModelError);
  });

  it("should create model with custom relationship to modeled element", async () => {
    const testImodel = imodel1;

    assert.isDefined(testImodel.getMetaData("TestBim:TestModelModelsElement"), "TestModelModelsElement is expected to be defined in TestBim.ecschema.xml");

    let newModelId1: Id64String;
    let newModelId2: Id64String;
    let relClassName1: string | undefined;
    let relClassName2: string | undefined;

    if (true) {
      const newPartition1 = IModelTestUtils.createAndInsertPhysicalPartition(testImodel, Code.createEmpty());
      relClassName1 = "TestBim:TestModelModelsElement";
      const modeledElementRef = new RelatedElement({ id: newPartition1, relClassName: relClassName1 });
      newModelId1 = IModelTestUtils.createAndInsertPhysicalModel(testImodel, modeledElementRef);
      assert.isTrue(Id64.isValidId64(newModelId1));
    }

    if (true) {
      [, newModelId2] = IModelTestUtils.createAndInsertPhysicalPartitionAndModel(testImodel, Code.createEmpty());
      const newModel2 = testImodel.models.getModel(newModelId2);
      relClassName2 = newModel2.modeledElement.relClassName;
    }

    const model1 = testImodel.models.getModel(newModelId1);
    const model2 = testImodel.models.getModel(newModelId2);

    const foundRelClassName1 = model1.modeledElement.relClassName;
    const foundRelClassName2 = model2.modeledElement.relClassName;

    assert.equal(foundRelClassName1, relClassName1);
    assert.equal(foundRelClassName2, relClassName2);
  });

  it("should create link table relationship instances", () => {
    const testImodel = imodel1;
    const elements = testImodel.elements;

    testImodel.nativeDb.enableTxnTesting();

    // Create a new physical model
    const newModelId = PhysicalModel.insert(testImodel, IModel.rootSubjectId, "TestModel");

    // create a SpatialCategory
    const spatialCategoryId = SpatialCategory.insert(testImodel, IModel.dictionaryId, "MySpatialCategory", new SubCategoryAppearance({ color: ColorByName.darkRed }));

    // Create a couple of physical elements.
    const elementProps: GeometricElementProps = {
      classFullName: PhysicalObject.classFullName,
      model: newModelId,
      category: spatialCategoryId,
      code: Code.createEmpty(),
    };

    const id0 = elements.insertElement(elementProps);
    const id1 = elements.insertElement(elementProps);
    const id2 = elements.insertElement(elementProps);

    const geometricModel = testImodel.models.getModel<GeometricModel>(newModelId);
    assert.throws(() => geometricModel.queryExtents()); // no geometry

    // Create grouping relationships from 0 to 1 and from 0 to 2
    const r1 = ElementGroupsMembers.create(testImodel, id0, id1, 1);
    r1.insert();
    const r2 = ElementGroupsMembers.create(testImodel, id0, id2);
    r2.insert();

    // Look up by id
    const g1 = ElementGroupsMembers.getInstance<ElementGroupsMembers>(testImodel, r1.id);
    const g2 = ElementGroupsMembers.getInstance<ElementGroupsMembers>(testImodel, r2.id);

    assert.deepEqual(g1.id, r1.id);
    assert.equal(g1.classFullName, ElementGroupsMembers.classFullName);
    assert.equal(g1.memberPriority, 1, "g1.memberPriority");
    assert.deepEqual(g2.id, r2.id);
    assert.equal(g2.classFullName, ElementGroupsMembers.classFullName);
    assert.equal(g2.memberPriority, 0, "g2.memberPriority");  // The memberPriority parameter defaults to 0 in ElementGroupsMembers.create

    // Look up by source and target
    const g1byst = ElementGroupsMembers.getInstance<ElementGroupsMembers>(testImodel, { sourceId: r1.sourceId, targetId: r1.targetId });
    assert.deepEqual(g1byst, g1);

    // Update relationship instance property
    r1.asAny.memberPriority = 2;
    r1.update();

    const g11 = ElementGroupsMembers.getInstance<ElementGroupsMembers>(testImodel, r1.id);
    assert.equal(g11.memberPriority, 2, "g11.memberPriority");
    testImodel.saveChanges("step 1");

    // Delete relationship instance property
    g11.delete();
    testImodel.saveChanges("step 2");
    assert.throws(() => ElementGroupsMembers.getInstance(testImodel, r1.id), IModelError);

    const d0 = elements.insertElement(elementProps);
    const d1 = elements.insertElement(elementProps);
    const ede1 = ElementDrivesElement.create(testImodel, d0, d1, 0);
    ede1.insert();
    testImodel.saveChanges("step 3");

    ede1.delete();
    testImodel.saveChanges("step 4");

  });

  it("should set EC properties of various types", async () => {

    const testImodel = imodel1;
    testImodel.getMetaData("TestBim:TestPhysicalObject");

    // Create a new physical model
    let newModelId: Id64String;
    [, newModelId] = IModelTestUtils.createAndInsertPhysicalPartitionAndModel(testImodel, Code.createEmpty(), true);

    // Find or create a SpatialCategory
    let spatialCategoryId = SpatialCategory.queryCategoryIdByName(testImodel, IModel.dictionaryId, "MySpatialCategory");
    if (undefined === spatialCategoryId) {
      spatialCategoryId = SpatialCategory.insert(testImodel, IModel.dictionaryId, "MySpatialCategory", new SubCategoryAppearance());
    }

    const trelClassName = "TestBim:TestPhysicalObjectRelatedToTestPhysicalObject";

    let id1: Id64String;
    let id2: Id64String;

    if (true) {
      // Create a couple of TestPhysicalObjects
      const elementProps: GeometricElementProps = {
        classFullName: "TestBim:TestPhysicalObject",
        model: newModelId,
        category: spatialCategoryId,
        code: Code.createEmpty(),
      };

      id1 = testImodel.elements.insertElement(testImodel.elements.createElement(elementProps));
      assert.isTrue(Id64.isValidId64(id1));

      // The second one should point to the first.
      elementProps.id = Id64.invalid;
      (elementProps as any).relatedElement = { id: id1, relClassName: trelClassName };
      elementProps.parent = { id: id1, relClassName: trelClassName };
      (elementProps as any).longProp = 4294967295;     // make sure that we can save values in the range 0 ... UINT_MAX

      id2 = testImodel.elements.insertElement(testImodel.elements.createElement(elementProps));
      assert.isTrue(Id64.isValidId64(id2));
    }

    if (true) {
      // Test that el2 points to el1
      const el2 = testImodel.elements.getElement(id2);
      assert.equal(el2.classFullName, "TestBim:TestPhysicalObject");
      assert.isTrue("relatedElement" in el2);
      assert.isTrue("id" in el2.asAny.relatedElement);
      assert.deepEqual(el2.asAny.relatedElement.id, id1);
      assert.equal(el2.asAny.longProp, 4294967295);

      // Even though I didn't set it, the platform knows the relationship class and reports it.
      assert.isTrue("relClassName" in el2.asAny.relatedElement);
      assert.equal(el2.asAny.relatedElement.relClassName.replace(".", ":"), trelClassName);
    }

    if (true) {
      // Change el2 to point to itself.
      const el2Modified = testImodel.elements.getElement(id2);
      el2Modified.asAny.relatedElement = { id: id2, relClassName: trelClassName };
      testImodel.elements.updateElement(el2Modified);
      // Test that el2 points to itself.
      const el2after: Element = testImodel.elements.getElement(id2);
      assert.deepEqual(el2after.asAny.relatedElement.id, id2);
      assert.equal(el2after.asAny.relatedElement.relClassName.replace(".", ":"), trelClassName);
    }

    if (true) {
      // Test that we can null out the navigation property
      const el2Modified = testImodel.elements.getElement(id2);
      el2Modified.asAny.relatedElement = null;
      testImodel.elements.updateElement(el2Modified);
      // Test that el2 has no relatedElement property value
      const el2after: Element = testImodel.elements.getElement(id2);
      assert.isUndefined(el2after.asAny.relatedElement);
    }
  });

  it("should be able to create a snapshot IModel", async () => {
    const args = {
      rootSubject: { name: "TestSubject", description: "test project" },
      client: "ABC Manufacturing",
      globalOrigin: { x: 10, y: 10 },
      projectExtents: { low: { x: -300, y: -300, z: -20 }, high: { x: 500, y: 500, z: 400 } },
      guid: Guid.createValue(),
    };

    const iModel = SnapshotIModelDb.createEmpty(IModelTestUtils.prepareOutputFile("IModel", "TestSnapshot.bim"), args);
    assert.equal(iModel.getGuid(), args.guid);
    assert.equal(iModel.rootSubject.name, args.rootSubject.name);
    assert.equal(iModel.rootSubject.description, args.rootSubject.description);
    assert.equal(iModel.projectExtents.low.x, args.projectExtents.low.x);
    assert.equal(iModel.projectExtents.low.y, args.projectExtents.low.y);
    assert.equal(iModel.projectExtents.low.z, args.projectExtents.low.z);
    assert.equal(iModel.globalOrigin.x, args.globalOrigin.x);
    assert.equal(iModel.globalOrigin.y, args.globalOrigin.y);
    assert.equal(iModel.globalOrigin.z, 0);

    const client = iModel.queryFilePropertyString({ name: "Client", namespace: "dgn_Db" });
    assert.equal(client, args.client, "query Client property");

    const dbguid = iModel.queryFilePropertyBlob({ name: "DbGuid", namespace: "be_Db" });
    assert.equal(dbguid!.byteLength, 16, "query guid property");

    const myPropsStr: FilePropertyProps = { name: "MyProp", namespace: "test1", id: 1, subId: 1 };
    const myStrVal = "this is a test";
    let stat = iModel.saveFileProperty(myPropsStr, myStrVal);
    assert.equal(stat, 0, "saveFileProperty as string");
    const readFromDb = iModel.queryFilePropertyString(myPropsStr);
    assert.equal(readFromDb, myStrVal, "query string after save");

    const myPropsBlob: FilePropertyProps = { name: "MyBlob", namespace: "test1", id: 10 };
    const testRange = new Uint8Array(500);
    testRange.fill(11);
    stat = iModel.saveFileProperty(myPropsBlob, undefined, testRange);
    assert.equal(stat, 0, "saveFileProperty as blob");
    const blobFromDb = iModel.queryFilePropertyBlob(myPropsBlob);
    assert.deepEqual(blobFromDb, testRange, "query blob after save");

    let next = iModel.queryNextAvailableFileProperty(myPropsBlob);
    assert.equal(11, next, "queryNextAvailableFileProperty blob");

    next = iModel.queryNextAvailableFileProperty(myPropsStr);
    assert.equal(2, next, "queryNextAvailableFileProperty str");
    assert.equal(0, iModel.deleteFileProperty(myPropsStr), "do deleteFileProperty");
    assert.equal(stat, 0, "deleteFileProperty");
    assert.isUndefined(iModel.queryFilePropertyString(myPropsStr), "property was deleted");
    next = iModel.queryNextAvailableFileProperty(myPropsStr);
    assert.equal(0, next, "queryNextAvailableFileProperty, should return 0 when none present");

    iModel.close();
  });

  it("The same promise can have two subscribers, and it will notify both.", async () => {
    const testPromise = new Promise((resolve, _reject) => {
      setTimeout(() => resolve("Success!"), 250);
    });

    let callbackcount = 0;
    testPromise.then(() => { // tslint:disable-line:no-floating-promises
      ++callbackcount;
    });
    testPromise.then(() => { // tslint:disable-line:no-floating-promises
      ++callbackcount;
    });

    await testPromise;

    assert.equal(callbackcount, 2);
  });

  // This is skipped because it fails unpredictably - the timeouts don't seem to happen as expected
  it.skip("should test AutoPush", async () => {
    let idle: boolean = true;
    const activityMonitor = {
      isIdle: idle,
    };

    const fakePushTimeRequired = 1; // pretend that it takes 1/1000 of a second to do the push
    const millisToWaitForAutoPush = (15 * fakePushTimeRequired); // a long enough wait to ensure that auto-push ran.

    const iModel = {
      pushChanges: async (_clientAccessToken: AccessToken) => {
        await new Promise((resolve, _reject) => { setTimeout(resolve, fakePushTimeRequired); }); // sleep, to simulate time spent doing push
        lastPushTimeMillis = Date.now();
      },
      iModelToken: {
        changeSetId: "",
        iModelId: "fake",
      },
      concurrencyControl: {
        request: async (_clientAccessToken: AccessToken) => { },
      },
      onBeforeClose: new BeEvent<() => void>(),
      txns: {
        hasLocalChanges: () => true,
      },
    };

    const authorizationClient: IAuthorizationClient = {
      getAccessToken: async (_requestContext: ClientRequestContext): Promise<AccessToken> => {
        const fakeAccessToken2 = {} as AccessToken;
        return fakeAccessToken2;
      },
      isAuthorized: true,
      hasExpired: false,
      hasSignedIn: true,
    };

    lastPushTimeMillis = 0;
    lastAutoPushEventType = undefined;

    // Create an autopush in manual-schedule mode.
    const autoPushParams: AutoPushParams = { pushIntervalSecondsMin: 0, pushIntervalSecondsMax: 1, autoSchedule: false };
    IModelHost.authorizationClient = authorizationClient;
    const autoPush = new AutoPush(iModel as any, autoPushParams, activityMonitor);
    assert.equal(autoPush.state, AutoPushState.NotRunning, "I configured auto-push NOT to start automatically");
    assert.isFalse(autoPush.autoSchedule);

    // Schedule the next push
    autoPush.scheduleNextPush();
    assert.equal(autoPush.state, AutoPushState.Scheduled);

    // Wait long enough for the auto-push to happen
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); });

    // Verify that push happened during the time that I was asleep.
    assert.equal(autoPush.state, AutoPushState.NotRunning, "I configured auto-push NOT to restart automatically");
    assert.notEqual(lastPushTimeMillis, 0);
    assert.isAtLeast(autoPush.durationOfLastPushMillis, fakePushTimeRequired);
    assert.isUndefined(lastAutoPushEventType);  // not listening to events yet.

    // Cancel the next scheduled push
    autoPush.cancel();
    assert.equal(autoPush.state, AutoPushState.NotRunning, "cancel does NOT automatically schedule the next push");

    // Register an event handler
    const autoPushEventHandler: AutoPushEventHandler = (etype: AutoPushEventType, _theAutoPush: AutoPush) => { lastAutoPushEventType = etype; };
    autoPush.event.addListener(autoPushEventHandler);

    lastPushTimeMillis = 0;

    // Explicitly schedule the next auto-push
    autoPush.scheduleNextPush();
    assert.equal(autoPush.state, AutoPushState.Scheduled);

    // wait long enough for the auto-push to happen
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); });
    assert.equal(autoPush.state, AutoPushState.NotRunning, "I configured auto-push NOT to start automatically");
    assert.notEqual(lastPushTimeMillis, 0);
    assert.equal(lastAutoPushEventType, AutoPushEventType.PushFinished, "event handler should have been called");

    // Just verify that this doesn't blow up.
    await autoPush.reserveCodes();

    // Now turn on auto-schedule and verify that we get a few auto-pushes
    lastPushTimeMillis = 0;
    autoPush.autoSchedule = true;
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.notEqual(lastPushTimeMillis, 0);
    lastPushTimeMillis = 0;
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.notEqual(lastPushTimeMillis, 0);
    autoPush.cancel();
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert(autoPush.state === AutoPushState.NotRunning);
    assert.isFalse(autoPush.autoSchedule, "cancel turns off autoSchedule");

    // Test auto-push when isIdle returns false
    idle = false;
    lastPushTimeMillis = 0;
    autoPush.autoSchedule = true; // start running AutoPush...
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.equal(lastPushTimeMillis, 0); // auto-push should not have run, because isIdle==false.
    assert.equal(autoPush.state, AutoPushState.Scheduled); // Instead, it should have re-scheduled
    autoPush.cancel();
    idle = true;

    // Test auto-push when Txn.hasLocalChanges returns false
    iModel.txns.hasLocalChanges = () => false;
    lastPushTimeMillis = 0;
    autoPush.cancel();
    autoPush.autoSchedule = true; // start running AutoPush...
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.equal(lastPushTimeMillis, 0); // auto-push should not have run, because isIdle==false.
    assert.equal(autoPush.state, AutoPushState.Scheduled); // Instead, it should have re-scheduled
    autoPush.cancel();

    // ... now turn it back on
    iModel.txns.hasLocalChanges = () => true;
    autoPush.autoSchedule = true; // start running AutoPush...
    await new Promise((resolve, _reject) => { setTimeout(resolve, millisToWaitForAutoPush); }); // let auto-push run
    assert.notEqual(lastPushTimeMillis, 0); // AutoPush should have run

    autoPush.cancel();
  });

  it.skip("ImodelJsTest.MeasureInsertPerformance", () => {

    const seedFileName = IModelTestUtils.resolveAssetFile("DgnPlatformSeedManager_OneSpatialModel10.bim");
    const testFileName = IModelTestUtils.prepareOutputFile("IModel", "ImodelJsTest_MeasureInsertPerformance.bim");
    const ifperfimodel = IModelTestUtils.createSnapshotFromSeed(testFileName, seedFileName);

    // tslint:disable-next-line:no-console
    console.time("ImodelJsTest.MeasureInsertPerformance");

    // TODO: Look up model by code (i.e., codevalue of a child of root subject, where child has a PhysicalPartition)
    // const physicalPartitionCode: Code = PhysicalPartition::CreateCode(*m_db->Elements().GetRootSubject(), "DefaultModel");
    // const modelId: Id64String = ifperfimodel.models.querySubModelId(physicalPartitionCode);
    const modelId = Id64.fromString("0X11");

    const defaultCategoryId: Id64String | undefined = SpatialCategory.queryCategoryIdByName(ifperfimodel, IModel.dictionaryId, "DefaultCategory");
    assert.isFalse(undefined === defaultCategoryId);

    const elementCount = 10000;
    for (let i = 0; i < elementCount; ++i) {
      const elementProps = { classFullName: "DgnPlatformTest:ImodelJsTestElement", model: modelId, id: Id64.invalid, code: Code.createEmpty(), category: defaultCategoryId };
      const element: Element = ifperfimodel.elements.createElement(elementProps);

      element.asAny.integerProperty1 = i;
      element.asAny.integerProperty2 = i;
      element.asAny.integerProperty3 = i;
      element.asAny.integerProperty4 = i;
      element.asAny.doubleProperty1 = i;
      element.asAny.doubleProperty2 = i;
      element.asAny.doubleProperty3 = i;
      element.asAny.doubleProperty4 = i;
      element.asAny.b = (0 === (i % 100));
      const pt: Point3d = new Point3d(i, 0, 0);
      element.asAny.pointProperty1 = pt;
      element.asAny.pointProperty2 = pt;
      element.asAny.pointProperty3 = pt;
      element.asAny.pointProperty4 = pt;
      // const dtUtc: Date = new Date("2013-09-15 12:05:39Z");    // Dates are so expensive to parse in native code that this skews the performance results
      // element.dtUtc = dtUtc;

      const insertedElemId = ifperfimodel.elements.insertElement(element);
      assert.isTrue(Id64.isValidId64(insertedElemId), "insert worked");
      if (0 === (i % 100))
        ifperfimodel.saveChanges();
    }

    ifperfimodel.saveChanges();

    ifperfimodel.withPreparedStatement("select count(*) as [count] from DgnPlatformTest.ImodelJsTestElement", (stmt: ECSqlStatement) => {
      assert.equal(DbResult.BE_SQLITE_ROW, stmt.step());
      const row = stmt.getRow();
      assert.equal(row.count, elementCount);
    });

    // tslint:disable-next-line:no-console
    console.timeEnd("ImodelJsTest.MeasureInsertPerformance");

  });

  function hasClassView(db: IModelDb, name: string): boolean {
    try {
      return db.withPreparedSqliteStatement(`SELECT ECInstanceId FROM [${name}]`, (): boolean => true);
    } catch (e) {
      return false;
    }
  }

  it("Snapshot iModel properties", () => {
    const snapshotRootSubjectName = "Snapshot";
    const snapshotFile1: string = IModelTestUtils.prepareOutputFile("IModel", "Snapshot1.bim");
    const snapshotFile2: string = IModelTestUtils.prepareOutputFile("IModel", "Snapshot2.bim");
    const snapshotFile3: string = IModelTestUtils.prepareOutputFile("IModel", "Snapshot3.bim");
    let snapshotDb1 = SnapshotIModelDb.createEmpty(snapshotFile1, { rootSubject: { name: snapshotRootSubjectName }, createClassViews: true });
    let snapshotDb2 = SnapshotIModelDb.createFrom(snapshotDb1, snapshotFile2);
    let snapshotDb3 = SnapshotIModelDb.createFrom(imodel1, snapshotFile3, { createClassViews: true });
    assert.isTrue(snapshotDb1 instanceof SnapshotIModelDb);
    assert.isTrue(snapshotDb2 instanceof SnapshotIModelDb);
    assert.isTrue(snapshotDb3 instanceof SnapshotIModelDb);
    assert.isTrue(snapshotDb1.isSnapshot);
    assert.isTrue(snapshotDb2.isSnapshot);
    assert.isTrue(snapshotDb3.isSnapshot);
    assert.isFalse(snapshotDb1.isReadonly, "Expect snapshots to be read-write during create");
    assert.isFalse(snapshotDb2.isReadonly, "Expect snapshots to be read-write during create");
    assert.isFalse(snapshotDb3.isReadonly, "Expect snapshots to be read-write during create");
    assert.equal(snapshotDb1.briefcase.briefcaseId, BriefcaseId.Snapshot);
    assert.equal(snapshotDb2.briefcase.briefcaseId, BriefcaseId.Snapshot);
    assert.equal(snapshotDb3.briefcase.briefcaseId, BriefcaseId.Snapshot);
    assert.equal(imodel1.briefcase.briefcaseId, BriefcaseId.Snapshot);
    assert.isFalse(snapshotDb1.nativeDb.isEncrypted());
    assert.isFalse(snapshotDb2.nativeDb.isEncrypted());
    assert.isFalse(snapshotDb3.nativeDb.isEncrypted());
    assert.isFalse(imodel1.nativeDb.isEncrypted());
    const iModelGuid1: GuidString = snapshotDb1.getGuid();
    const iModelGuid2: GuidString = snapshotDb2.getGuid();
    const iModelGuid3: GuidString = snapshotDb3.getGuid();
    assert.notEqual(iModelGuid1, iModelGuid2, "Expect different iModel GUIDs for each snapshot");
    assert.notEqual(iModelGuid2, iModelGuid3, "Expect different iModel GUIDs for each snapshot");
    const rootSubjectName1 = snapshotDb1.elements.getRootSubject().code.getValue();
    const rootSubjectName2 = snapshotDb2.elements.getRootSubject().code.getValue();
    const rootSubjectName3 = snapshotDb3.elements.getRootSubject().code.getValue();
    const imodel1RootSubjectName = imodel1.elements.getRootSubject().code.getValue();
    assert.equal(rootSubjectName1, snapshotRootSubjectName);
    assert.equal(rootSubjectName1, rootSubjectName2, "Expect a snapshot to maintain the root Subject name from its seed");
    assert.equal(rootSubjectName3, imodel1RootSubjectName, "Expect a snapshot to maintain the root Subject name from its seed");
    snapshotDb1.close();
    snapshotDb2.close();
    snapshotDb3.close();
    snapshotDb1 = SnapshotIModelDb.open(snapshotFile1);
    snapshotDb2 = SnapshotIModelDb.open(snapshotFile2);
    snapshotDb3 = SnapshotIModelDb.open(snapshotFile3);
    assert.isTrue(snapshotDb1.isReadonly, "Expect snapshots to be read-only after open");
    assert.isTrue(snapshotDb2.isReadonly, "Expect snapshots to be read-only after open");
    assert.isTrue(snapshotDb3.isReadonly, "Expect snapshots to be read-only after open");
    assert.isTrue(hasClassView(snapshotDb1, "bis.Element"));
    assert.isTrue(hasClassView(snapshotDb1, "bis.ElementAspect"));
    assert.isTrue(hasClassView(snapshotDb1, "bis.Model"));
    assert.isTrue(hasClassView(snapshotDb1, "bis.ElementRefersToElements"));
    assert.isFalse(hasClassView(snapshotDb2, "bis.Element"));
    assert.isTrue(hasClassView(snapshotDb3, "bis.Element"));
    snapshotDb1.close();
    snapshotDb2.close();
    snapshotDb3.close();
  });

  it("Password-protected Snapshot iModels", () => {
    const snapshotFile1: string = IModelTestUtils.prepareOutputFile("IModel", "pws1.bim");
    const snapshotFile2: string = IModelTestUtils.prepareOutputFile("IModel", "pws2.bim");
    const snapshotFile3: string = IModelTestUtils.prepareOutputFile("IModel", "pws3.bim");
    const snapshotFile4: string = IModelTestUtils.prepareOutputFile("IModel", "pws4.bim");

    // create snapshot from scratch without a password, then unnecessarily specify a password to open
    let snapshotDb1 = SnapshotIModelDb.createFrom(imodel1, snapshotFile1);
    assert.equal(snapshotDb1.briefcase.briefcaseId, BriefcaseId.Snapshot);
    snapshotDb1.close();
    snapshotDb1 = SnapshotIModelDb.open(snapshotFile1, { password: "unnecessaryPassword" });
    assert.isTrue(snapshotDb1 instanceof SnapshotIModelDb);
    assert.isTrue(snapshotDb1.isSnapshot);
    assert.isTrue(snapshotDb1.isReadonly, "Expect snapshots to be read-only after open");
    assert.isFalse(snapshotDb1.nativeDb.isEncrypted());
    assert.isFalse(hasClassView(snapshotDb1, "bis.Element"));

    // create snapshot from scratch and give it a password
    let snapshotDb2 = SnapshotIModelDb.createEmpty(snapshotFile2, { rootSubject: { name: "Password-Protected" }, password: "password", createClassViews: true });
    assert.equal(snapshotDb2.briefcase.briefcaseId, BriefcaseId.Snapshot);
    const subjectName2 = "TestSubject2";
    const subjectId2: Id64String = Subject.insert(snapshotDb2, IModel.rootSubjectId, subjectName2);
    assert.isTrue(Id64.isValidId64(subjectId2));
    snapshotDb2.close();
    snapshotDb2 = SnapshotIModelDb.open(snapshotFile2, { password: "password" });
    assert.isTrue(snapshotDb2 instanceof SnapshotIModelDb);
    assert.isTrue(snapshotDb2.isSnapshot);
    assert.isTrue(snapshotDb2.isReadonly, "Expect snapshots to be read-only after open");
    assert.isTrue(snapshotDb2.nativeDb.isEncrypted());
    assert.exists(snapshotDb2.elements.getElement(subjectId2));
    assert.isTrue(hasClassView(snapshotDb2, "bis.Element"));

    // create a new snapshot from a non-password-protected snapshot and then give it a password
    let snapshotDb3 = SnapshotIModelDb.createFrom(imodel1, snapshotFile3, { password: "password" });
    assert.equal(snapshotDb3.briefcase.briefcaseId, BriefcaseId.Snapshot);
    snapshotDb3.close();
    snapshotDb3 = SnapshotIModelDb.open(snapshotFile3, { password: "password" });
    assert.isTrue(snapshotDb3 instanceof SnapshotIModelDb);
    assert.isTrue(snapshotDb3.isSnapshot);
    assert.isTrue(snapshotDb3.isReadonly, "Expect snapshots to be read-only after open");
    assert.isTrue(snapshotDb3.nativeDb.isEncrypted());

    // it is invalid to create a snapshot from a password-protected iModel
    assert.throws(() => SnapshotIModelDb.createFrom(snapshotDb2, snapshotFile4), IModelError);
    assert.isFalse(IModelJsFs.existsSync(snapshotFile4));
    assert.throws(() => SnapshotIModelDb.createFrom(snapshotDb2, snapshotFile4, { password: "password" }), IModelError);
    assert.isFalse(IModelJsFs.existsSync(snapshotFile4));

    snapshotDb1.close();
    snapshotDb2.close();
    snapshotDb3.close();
  });

  it("Run plain SQL", () => {
    imodel1.withPreparedSqliteStatement("CREATE TABLE Test(Id INTEGER PRIMARY KEY, Name TEXT NOT NULL, Code INTEGER)", (stmt: SqliteStatement) => {
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("INSERT INTO Test(Name,Code) VALUES(?,?)", (stmt: SqliteStatement) => {
      stmt.bindValue(1, "Dummy 1");
      stmt.bindValue(2, 100);
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("INSERT INTO Test(Name,Code) VALUES(?,?)", (stmt: SqliteStatement) => {
      stmt.bindValues(["Dummy 2", 200]);
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("INSERT INTO Test(Name,Code) VALUES(:p1,:p2)", (stmt: SqliteStatement) => {
      stmt.bindValue(":p1", "Dummy 3");
      stmt.bindValue(":p2", 300);
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("INSERT INTO Test(Name,Code) VALUES(:p1,:p2)", (stmt: SqliteStatement) => {
      stmt.bindValues({ ":p1": "Dummy 4", ":p2": 400 });
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.saveChanges();

    imodel1.withPreparedSqliteStatement("SELECT Id,Name,Code FROM Test ORDER BY Id", (stmt: SqliteStatement) => {
      for (let i: number = 1; i <= 4; i++) {
        assert.equal(stmt.step(), DbResult.BE_SQLITE_ROW);
        assert.equal(stmt.getColumnCount(), 3);
        const val0: SqliteValue = stmt.getValue(0);
        assert.equal(val0.columnName, "Id");
        assert.equal(val0.type, SqliteValueType.Integer);
        assert.isFalse(val0.isNull);
        assert.equal(val0.getInteger(), i);

        const val1: SqliteValue = stmt.getValue(1);
        assert.equal(val1.columnName, "Name");
        assert.equal(val1.type, SqliteValueType.String);
        assert.isFalse(val1.isNull);
        assert.equal(val1.getString(), `Dummy ${i}`);

        const val2: SqliteValue = stmt.getValue(2);
        assert.equal(val2.columnName, "Code");
        assert.equal(val2.type, SqliteValueType.Integer);
        assert.isFalse(val2.isNull);
        assert.equal(val2.getInteger(), i * 100);

        const row: any = stmt.getRow();
        assert.equal(row.id, i);
        assert.equal(row.name, `Dummy ${i}`);
        assert.equal(row.code, i * 100);
      }
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });

    imodel1.withPreparedSqliteStatement("SELECT 1 FROM ec_CustomAttribute WHERE ContainerId=? AND Instance LIKE '<IsMixin%' COLLATE NOCASE", (stmt: SqliteStatement) => {
      stmt.bindValue(1, "0x1f");
      assert.equal(stmt.step(), DbResult.BE_SQLITE_DONE);
    });
  });

  it("Run plain SQL against readonly connection", () => {
    let iModel = SnapshotIModelDb.createEmpty(IModelTestUtils.prepareOutputFile("IModel", "sqlitesqlreadonlyconnection.bim"), { rootSubject: { name: "test" } });
    const iModelPath: string = iModel.briefcase.pathname;
    iModel.close();
    iModel = SnapshotIModelDb.open(iModelPath);

    iModel.withPreparedSqliteStatement("SELECT Name,StrData FROM be_Prop WHERE Namespace='ec_Db'", (stmt: SqliteStatement) => {
      let rowCount: number = 0;
      while (stmt.step() === DbResult.BE_SQLITE_ROW) {
        rowCount++;
        assert.equal(stmt.getColumnCount(), 2);
        const nameVal: SqliteValue = stmt.getValue(0);
        assert.equal(nameVal.columnName, "Name");
        assert.equal(nameVal.type, SqliteValueType.String);
        assert.isFalse(nameVal.isNull);
        const name: string = nameVal.getString();

        const versionVal: SqliteValue = stmt.getValue(1);
        assert.equal(versionVal.columnName, "StrData");
        assert.equal(versionVal.type, SqliteValueType.String);
        assert.isFalse(versionVal.isNull);
        const profileVersion: any = JSON.parse(versionVal.getString());

        assert.isTrue(name === "SchemaVersion" || name === "InitialSchemaVersion");
        if (name === "SchemaVersion") {
          assert.equal(profileVersion.major, 4);
          assert.equal(profileVersion.minor, 0);
          assert.equal(profileVersion.sub1, 0);
          assert.isAtLeast(profileVersion.sub2, 1);
        } else if (name === "InitialSchemaVersion") {
          assert.equal(profileVersion.major, 4);
          assert.equal(profileVersion.minor, 0);
          assert.equal(profileVersion.sub1, 0);
          assert.isAtLeast(profileVersion.sub2, 1);
        }
      }
      assert.equal(rowCount, 2);
    });
    iModel.close();
  });

  it("containsClass", () => {
    assert.isTrue(imodel1.containsClass(Element.classFullName));
    assert.isTrue(imodel1.containsClass("BisCore:Element"));
    assert.isTrue(imodel1.containsClass("BisCore.Element"));
    assert.isTrue(imodel1.containsClass("biscore:element"));
    assert.isTrue(imodel1.containsClass("biscore.element"));
    assert.isTrue(imodel1.containsClass("bis:Element"));
    assert.isTrue(imodel1.containsClass("bis.Element"));
    assert.isTrue(imodel1.containsClass("bis:element"));
    assert.isTrue(imodel1.containsClass("bis.element"));
    assert.isFalse(imodel1.containsClass("BisCore:Element:InvalidExtra"));
    assert.isFalse(imodel1.containsClass("BisCore"));
    assert.isFalse(imodel1.containsClass(":Element"));
    assert.isFalse(imodel1.containsClass("BisCore:InvalidClassName"));
    assert.isFalse(imodel1.containsClass("InvalidSchemaName:Element"));
  });
});
