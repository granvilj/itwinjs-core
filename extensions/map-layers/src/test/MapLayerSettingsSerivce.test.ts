/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import * as chai from "chai";
import * as sinon from "sinon";
import { Guid, GuidString } from "@itwin/core-bentley";

import { MapLayerPreferences } from "../MapLayerPreferences";
import { IModelApp, MapLayerSource } from "@itwin/core-frontend";
import { restore, setup } from "./UserPreferencesMock";

chai.should();
describe("MapLayerPreferences", () => {
  const iTwinId: GuidString = Guid.createValue();
  const iModelId: GuidString = Guid.createValue();
  const testName: string = `test${Guid.createValue()}`;

  before(async () => {
    setup();
  });
  after(async () => {
    restore();
    sinon.restore();
  });

  it("should store and retrieve layer", async () => {
    const layer = MapLayerSource.fromJSON({
      url: "test12345",
      name: testName,
      formatId: "test12345",
      transparentBackground: true,
    });
    chai.assert.isDefined(layer);
    let sources = await MapLayerPreferences.getSources(iTwinId, iModelId);
    let foundSource = sources.some((value) => { return value.name === testName; });
    chai.assert.isFalse(foundSource, "expect not to find the source as it has not been stored yet");
    const success = await MapLayerPreferences.storeSource(layer!, false, iTwinId, iModelId);
    chai.assert.isTrue(success);

    sources = await MapLayerPreferences.getSources(iTwinId, iModelId);
    foundSource = sources.some((value) => { return value.name === testName; });
    chai.assert.isTrue(foundSource);
    await IModelApp.userPreferences?.delete({
      key: `${(MapLayerPreferences as any).SourceNamespace}.${testName}`,
      iTwinId,
    });

    const val = await IModelApp.userPreferences?.get({
      key: `${(MapLayerPreferences as any).SourceNamespace}.${testName}`,
      iTwinId,
    });
    chai.assert.isUndefined(val, "the map layer should no longer exist");
  });

  it("should not be able to store model setting if same setting exists as project setting", async () => {
    const layer = MapLayerSource.fromJSON({
      url: "test12345",
      name: testName,
      formatId: "test12345",
      transparentBackground: true,
    });
    let success = await MapLayerPreferences.storeSource(layer!, false, iTwinId, iModelId);
    chai.assert.isTrue(success);
    success = await MapLayerPreferences.storeSource(layer!, true, iTwinId, iModelId);
    chai.assert.isFalse(success, "cannot store the iModel setting that conflicts with an iTwin setting");
    await IModelApp.userPreferences?.delete({
      key: `${(MapLayerPreferences as any).SourceNamespace}.${testName}`,
      iTwinId,
    });

    const val = await IModelApp.userPreferences?.get({
      key: `${(MapLayerPreferences as any).SourceNamespace}.${testName}`,
      iTwinId,
    });
    chai.assert.isUndefined(val, "the map layer should no longer exist");
  });

  it("should be able to store project setting if same setting exists as project setting", async () => {
    const layer = MapLayerSource.fromJSON({
      url: "test12345",
      name: testName,
      formatId: "test12345",
      transparentBackground: true,
    });
    let success = await MapLayerPreferences.storeSource(layer!, true, iTwinId, iModelId);
    chai.assert.isTrue(success);
    success = await MapLayerPreferences.storeSource(layer!, false, iTwinId, iModelId);
    chai.assert.isTrue(success);
    await IModelApp.userPreferences?.delete({
      key: `${(MapLayerPreferences as any).SourceNamespace}.${testName}`,
      iTwinId,
    });

    const val = await IModelApp.userPreferences?.get({
      key: `${(MapLayerPreferences as any).SourceNamespace}.${testName}`,
      iTwinId,
    });
    chai.assert.isUndefined(val, "the map layer should no longer exist");
  });

  it("should be able to delete a mapSource stored on project and imodel level", async () => {
    const layer = MapLayerSource.fromJSON({
      url: "test12345",
      name: testName,
      formatId: "test12345",
      transparentBackground: true,
    });

    chai.assert.isDefined(layer);

    chai.assert.isTrue(await MapLayerPreferences.storeSource(layer!, true, iTwinId, iModelId));
    await MapLayerPreferences.deleteByName(layer!, iTwinId, iModelId);
    chai.assert.isUndefined(MapLayerPreferences.getByUrl(layer!.url, iTwinId, iModelId));

    chai.assert.isTrue(await MapLayerPreferences.storeSource(layer!, false, iTwinId, iModelId));
    await MapLayerPreferences.deleteByName(layer!, iTwinId, iModelId);
    chai.assert.isUndefined(MapLayerPreferences.getByUrl(layer!.url, iTwinId, iModelId));
  });
});
