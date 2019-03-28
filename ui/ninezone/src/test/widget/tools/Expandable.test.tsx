/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { mount, shallow } from "enzyme";
import * as React from "react";
import { ExpandableButton } from "../../../ui-ninezone";

describe("<ExpandableButton  />", () => {
  it("should render", () => {
    mount(<ExpandableButton />);
  });

  it("renders correctly", () => {
    shallow(<ExpandableButton />).should.matchSnapshot();
  });
});
