/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2017 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/

import { assert } from "chai";
<<<<<<< HEAD
import { IModel, ColorDef } from "../IModel";
import { Id } from "../Element";
=======
import { ColorDef, IModel } from "../IModel";
import { Id, Code } from "../Element";
>>>>>>> e757b0905d3bdb39ef289361697478710d5a3075
import { ViewFlags, RenderMode } from "../Render";
import { ModelSelector } from "../ViewDefinition";

describe("iModel", () => {
  it("should open", () => {
    var imodel: IModel = new IModel();
    var res = imodel.openDgnDb("mf3.ibim");
    assert(!res);
  })
});

describe("ElementId", () => {

  it("ElementId should construct properly", () => {
    const id1 = new Id("0x123");
    assert(id1.isValid(), "good");
    const id2 = new Id("badness");
    assert(!id2.isValid());
    const id3 = new Id("0xtbadness");
    assert(!id3.isValid());
    const id4 = new Id("0x1234567890abc");
    assert(id4.isValid());
    assert(id4.b === 0x123);
    const i5 = "0X20000000001";
    const id5 = new Id(i5);
    assert(id5.b === 0x2 && id5.l === 0x1);
    const o5 = id5.toString();
    assert(o5 === i5);
    const id6 = new Id(100, 200);
    const v6 = id6.toString();
    const id7 = new Id(v6);
    assert(id6.equals(id7));
  });

  it("ViewFlags", () => {
    const flags = new ViewFlags();
    assert(flags.acsTriad === false);
    assert(flags.grid === false);
    assert(flags.fill === true);
    assert(flags.renderMode === RenderMode.Wireframe);
  });

  it("Model Selectors should hold models", () => {
    const imodel1 = new IModel("abc");
    const params = {
      iModel: imodel1,
      className: "bis.Element",
      modelId: new Id(1, 1),
      code: new Code("abc"),
      id: new Id(),
    };

    const selector1 = new ModelSelector(params);
    assert(!selector1.id.isValid())
  });

  it("ColorDef should compare properly", () => {
    const color1 = ColorDef.from(1, 2, 3, 0);
    const color2 = ColorDef.from(1, 2, 3, 0);
    const color3 = ColorDef.from(0xa, 2, 3, 0);
    const blue = ColorDef.blue();

    assert(color1.equals(color2), "A");
    assert(!color1.equals(blue), "B");

    const blueVal = blue.rgba;
    assert(blueVal === 0xff0000);
    assert(blue.equals(new ColorDef(blueVal)));

    const colors = color3.getColors();
    ColorDef.from(colors.r, colors.g, colors.b, 0x30, color3);
    assert(color3.equals(ColorDef.from(0xa, 2, 3, 0x30)));
  });
});
