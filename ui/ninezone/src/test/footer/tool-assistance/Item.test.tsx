/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { mount, shallow } from "enzyme";
import * as React from "react";

import { ToolAssistanceItem } from "../../../ui-ninezone";

describe("<ToolAssistanceItem />", () => {
  it("should render", () => {
    mount(<ToolAssistanceItem />);
  });

  it("renders correctly", () => {
    shallow(<ToolAssistanceItem />).should.matchSnapshot();
  });
});
