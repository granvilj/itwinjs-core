/*---------------------------------------------------------------------------------------------
|  $Copyright: (c) 2018 Bentley Systems, Incorporated. All rights reserved. $
 *--------------------------------------------------------------------------------------------*/
import * as React from "react";
import { expect } from "chai";
import TestUtils from "../TestUtils";
import { WidgetState, WidgetProps, WidgetDef, ConfigurableUiManager, WidgetControl, ConfigurableCreateInfo } from "../../src/index";

describe("WidgetControl", () => {

  class TestWidget extends WidgetControl {
    constructor(info: ConfigurableCreateInfo, options: any) {
      super(info, options);

      this.reactElement = <div />;
    }
  }

  before(async () => {
    await TestUtils.initializeUiFramework();
    ConfigurableUiManager.registerControl("WidgetControlTest", TestWidget);
  });

  const widgetProps: WidgetProps = {
    classId: "WidgetControlTest",
  };

  it("registerControl & widgetControl using same classId", () => {
    const widgetDef: WidgetDef = new WidgetDef(widgetProps);
    const widgetControl = widgetDef.widgetControl;

    expect(widgetControl).to.not.be.undefined;
    if (widgetControl)
      expect(widgetControl.widgetDef).to.eq(widgetDef);
  });

  it("setWidgetState", () => {
    const widgetDef: WidgetDef = new WidgetDef(widgetProps);
    const widgetControl = widgetDef.widgetControl;

    expect(widgetControl).to.not.be.undefined;
    if (widgetControl)
      widgetControl.setWidgetState(WidgetState.Open);

    expect(widgetDef.isDefaultOpen).to.be.true;
    expect(widgetDef.defaultOpenUsed).to.be.false;
  });

});
