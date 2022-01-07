/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import "./ViewportContentControl.css";
import * as React from "react";
import { Id64String } from "@itwin/core-bentley";
import { IModelApp, IModelConnection, ScreenViewport, ViewState } from "@itwin/core-frontend";
import { viewWithUnifiedSelection } from "@itwin/presentation-components";
import { ViewportComponent } from "@itwin/imodel-components-react";
import ViewDefinitionSelector, { getViewDefinitions } from "./ViewDefinitionSelector";
import { ContentViewManager, FloatingViewportContentControl, UiShowHideManager } from "@itwin/appui-react";

// eslint-disable-next-line @typescript-eslint/naming-convention
const SampleViewport = viewWithUnifiedSelection(ViewportComponent);

export interface ViewportContentComponentProps {
  imodel: IModelConnection;
  onContextMenu?: (e: React.MouseEvent) => boolean;
  id: string;
  showViewPicker?: boolean;
}

export default function ViewportContentComponent(props: ViewportContentComponentProps) { // eslint-disable-line @typescript-eslint/naming-convention
  const [viewport, setViewport] = React.useState<ScreenViewport | undefined>();
  const [selectedViewDefinitionId, setSelectedViewDefinitionId] = React.useState<Id64String | undefined>();
  const [prevIModel, setPrevIModel] = React.useState<IModelConnection | undefined>(props.imodel);
  if (prevIModel !== props.imodel) {
    setSelectedViewDefinitionId(undefined);
    setPrevIModel(props.imodel);
  }
  const contentControl = React.useRef<FloatingViewportContentControl | undefined>();
  const [initialViewState, setInitialViewState] = React.useState<ViewState | undefined>();

  React.useEffect(() => {
    async function fetchView(viewId: string | undefined) {
      if (undefined === viewId) {
        const definitions = await getViewDefinitions(props.imodel);
        if (definitions && definitions.length) {
          viewId = definitions[0].id;
        }
      }
      if (contentControl.current && viewId) {
        const viewState = await props.imodel.views.load(viewId);
        setInitialViewState(viewState);
      }
      if (viewId !== selectedViewDefinitionId) setSelectedViewDefinitionId(viewId);
    }
    void fetchView(selectedViewDefinitionId);
  }, [props.imodel, selectedViewDefinitionId]);

  const onViewDefinitionChanged = React.useCallback((id?: Id64String) => {
    setSelectedViewDefinitionId(id);
  }, []);

  const onViewportRef = React.useCallback((v: ScreenViewport) => setViewport(v), []);

  React.useEffect(() => {
    if (!contentControl.current) {
      contentControl.current = new FloatingViewportContentControl(props.id, props.id, null);
      ContentViewManager.addFloatingContentControl(contentControl.current);
    }
    return () => {
      if (contentControl.current) {
        ContentViewManager.dropFloatingContentControl(contentControl.current);
        contentControl.current = undefined;
      }
    };
  }, [props.id]);

  const viewPortControl = React.useMemo(() =>
    initialViewState ? (
      <SampleViewport
        viewportRef={onViewportRef}
        imodel={props.imodel}
        viewState={initialViewState}
        onContextMenu={props.onContextMenu}
      />
    ) : undefined, [onViewportRef, props.imodel, props.onContextMenu, initialViewState]);

  React.useEffect(() => {
    if (viewport && contentControl.current) {
      contentControl.current.viewport = viewport;
      if (null === contentControl.current.reactNode) {
        contentControl.current.reactNode = viewPortControl;
        if (initialViewState) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          contentControl.current.processViewSelectorChange(props.imodel, initialViewState.id, initialViewState, initialViewState.name);
        }
      }
    }
  }, [initialViewState, props.imodel, viewPortControl, viewport]);

  React.useEffect(() => {
    const onViewClose = (vp: ScreenViewport) => {
      if (contentControl.current?.viewport === vp) {
        ContentViewManager.dropFloatingContentControl(contentControl.current);
        contentControl.current = undefined;
      }
    };
    return IModelApp.viewManager.onViewClose.addListener(onViewClose);
  }, []);

  return (
    <div onMouseMove={UiShowHideManager.handleContentMouseMove} className="uifw-dialog-imodel-content" style={{ height: "100%", position: "relative" }}>
      {viewPortControl}
      {!!props.showViewPicker && <ViewDefinitionSelector imodel={props.imodel} selectedViewDefinition={selectedViewDefinitionId} onViewDefinitionSelected={onViewDefinitionChanged} />}
    </div>
  );
}
