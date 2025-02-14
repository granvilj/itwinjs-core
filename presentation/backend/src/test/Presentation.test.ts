/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { expect } from "chai";
import * as faker from "faker";
import * as sinon from "sinon";
import * as moq from "typemoq";
import { IModelHost, IpcHost } from "@itwin/core-backend";
import { assert } from "@itwin/core-bentley";
import { RpcManager } from "@itwin/core-common";
import { PresentationError } from "@itwin/presentation-common";
import { MultiManagerPresentationProps, Presentation } from "../presentation-backend/Presentation";
import { PresentationIpcHandler } from "../presentation-backend/PresentationIpcHandler";
import { PresentationManager } from "../presentation-backend/PresentationManager";
import { PresentationRpcImpl } from "../presentation-backend/PresentationRpcImpl";
import { TemporaryStorage } from "../presentation-backend/TemporaryStorage";

describe("Presentation", () => {

  afterEach(async () => {
    Presentation.terminate();
  });

  describe("initialize", () => {

    it("registers rpc implementation", () => {
      const registerSpy = sinon.spy(RpcManager, "registerImpl");
      Presentation.initialize();
      expect(registerSpy).to.be.calledOnce;
    });

    it("registers itself as IModelHost shutdown listener", () => {
      const addListenerSpy = sinon.spy(IModelHost.onBeforeShutdown, "addListener");
      Presentation.initialize();
      expect(addListenerSpy).to.be.calledOnce;
    });

    it("can be safely shutdown via IModelHost shutdown listener", async () => {
      await IModelHost.startup();
      Presentation.initialize();
      await IModelHost.shutdown();
      expect(() => Presentation.getManager()).to.throw(PresentationError);
    });

    it("creates a manager instance", () => {
      expect(() => Presentation.getManager()).to.throw(PresentationError);
      Presentation.initialize();
      expect(Presentation.getManager()).to.be.instanceof(PresentationManager);
    });

    describe("props handling", () => {

      it("sets unused client lifetime provided through props", () => {
        Presentation.initialize({ unusedClientLifetime: faker.random.number() });
        const storage = (Presentation as any)._clientsStorage as TemporaryStorage<PresentationManager>;
        expect(storage.props.unusedValueLifetime).to.eq((Presentation.initProps! as MultiManagerPresentationProps).unusedClientLifetime);
      });

      it("sets request timeout to `PresentationRpcImpl`", () => {
        const supplyImplSpy = sinon.spy(RpcManager, "supplyImplInstance");
        Presentation.initialize({ requestTimeout: 123 });
        const impl = supplyImplSpy.args[0][1];
        assert(impl instanceof PresentationRpcImpl);
        expect(impl.requestTimeout).to.eq(123);
        expect(Presentation.getRequestTimeout()).to.eq(123);
      });

      it("uses client manager factory provided through props", () => {
        const managerMock = moq.Mock.ofType<PresentationManager>();
        Presentation.initialize({ clientManagerFactory: () => managerMock.object });
        expect(Presentation.getManager()).to.eq(managerMock.object);
      });

      it("uses useSingleManager flag to create one manager for all clients", () => {
        Presentation.initialize({ useSingleManager: true });
        const manager = Presentation.getManager();
        expect(manager).to.be.instanceOf(PresentationManager);
        const clientId = faker.random.word();
        expect(manager).to.be.eq(Presentation.getManager(clientId));
      });

    });

  });

  describe("getRequestTimeout", () => {

    it("should throw PresentationError if initialize is not called", () => {
      expect(() => Presentation.getRequestTimeout()).to.throw(PresentationError);
    });

  });

  describe("terminate", () => {

    it("resets manager instance", () => {
      Presentation.initialize();
      expect(Presentation.getManager()).to.be.not.null;
      Presentation.terminate();
      expect(() => Presentation.getManager()).to.throw(PresentationError);
    });

    it("unregisters PresentationRpcInterface impl", () => {
      Presentation.initialize();
      const unregisterSpy = sinon.stub(RpcManager, "unregisterImpl");
      Presentation.terminate();
      expect(unregisterSpy).to.be.calledOnce;
    });

    it("unregisters PresentationIpcHandler if IpcHost is valid", () => {
      sinon.stub(IpcHost, "isValid").get(() => true);
      const unregisterSpy = sinon.spy();
      sinon.stub(PresentationIpcHandler, "register").returns(unregisterSpy);
      Presentation.initialize();
      expect(unregisterSpy).to.not.be.called;
      Presentation.terminate();
      expect(unregisterSpy).to.be.calledOnce;
    });

  });

});
