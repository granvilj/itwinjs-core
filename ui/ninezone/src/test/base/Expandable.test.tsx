/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { mount, shallow } from "enzyme";
import * as React from "react";

import { Expandable, Direction } from "../../ui-ninezone";

describe("<Expandable />", () => {
  it("should render", () => {
    mount(<Expandable />);
  });

  it("renders correctly", () => {
    shallow(<Expandable />).should.matchSnapshot();
  });

  it("should set direction class", () => {
    shallow(<Expandable direction={Direction.Left} />).should.matchSnapshot();
  });
});
