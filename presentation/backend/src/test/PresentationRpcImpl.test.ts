/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { expect } from "chai";
import * as faker from "faker";
import * as sinon from "sinon";
import * as moq from "typemoq";
import { IModelDb } from "@itwin/core-backend";
import { Id64String, using } from "@itwin/core-bentley";
import { IModelNotFoundResponse, IModelRpcProps } from "@itwin/core-common";
import {
  Content, ContentDescriptorRequestOptions, ContentDescriptorRpcRequestOptions, ContentFlags, ContentInstanceKeysRpcRequestOptions,
  ContentRequestOptions, ContentRpcRequestOptions, ContentSourcesRequestOptions, ContentSourcesRpcRequestOptions, ContentSourcesRpcResult, Descriptor,
  DescriptorOverrides, DiagnosticsScopeLogs, DisplayLabelRequestOptions, DisplayLabelRpcRequestOptions, DisplayLabelsRequestOptions,
  DisplayLabelsRpcRequestOptions, DistinctValuesRequestOptions, DistinctValuesRpcRequestOptions, ElementProperties, FieldDescriptor,
  FieldDescriptorType, FilterByInstancePathsHierarchyRequestOptions, FilterByTextHierarchyRequestOptions, HierarchyRequestOptions,
  HierarchyRpcRequestOptions, InstanceKey, Item, KeySet, Node, NodeKey, NodePathElement, Paged, PageOptions, PresentationError,
  PresentationRpcRequestOptions, PresentationStatus, RulesetVariable, RulesetVariableJSON, SelectClassInfo, SelectionScopeRequestOptions,
  SingleElementPropertiesRequestOptions, SingleElementPropertiesRpcRequestOptions, VariableValueTypes,
} from "@itwin/presentation-common";
import {
  createRandomECInstanceKey, createRandomECInstancesNode, createRandomECInstancesNodeKey, createRandomId, createRandomLabelDefinitionJSON,
  createRandomNodePathElement, createRandomSelectionScope, createTestContentDescriptor, createTestECInstanceKey, createTestSelectClassInfo,
  ResolvablePromise,
} from "@itwin/presentation-common/lib/cjs/test";
import { NativePlatformDefinition } from "../presentation-backend/NativePlatform";
import { Presentation } from "../presentation-backend/Presentation";
import { PresentationManager } from "../presentation-backend/PresentationManager";
import { MAX_ALLOWED_KEYS_PAGE_SIZE, MAX_ALLOWED_PAGE_SIZE, PresentationRpcImpl } from "../presentation-backend/PresentationRpcImpl";
import { RulesetManager } from "../presentation-backend/RulesetManager";
import { RulesetVariablesManager } from "../presentation-backend/RulesetVariablesManager";

describe("PresentationRpcImpl", () => {

  afterEach(() => {
    Presentation.terminate();
  });

  it("uses default PresentationManager implementation if not overridden", () => {
    Presentation.initialize({
      addon: moq.Mock.ofType<NativePlatformDefinition>().object,
    });
    using(new PresentationRpcImpl(), (impl) => {
      expect(impl.getManager()).is.instanceof(PresentationManager);
    });
  });

  it("uses custom requestTimeout", () => {
    const randomRequestTimeout = faker.random.number({ min: 0, max: 90000 });
    using(new PresentationRpcImpl({ requestTimeout: randomRequestTimeout }), (impl) => {
      expect(impl.requestTimeout).to.not.throw;
      expect(impl.requestTimeout).to.equal(randomRequestTimeout);
    });
  });

  it("returns all diagnostics when `PresentationManager` calls diagnostics handler multiple times", async () => {
    const rulesetsMock = moq.Mock.ofType<RulesetManager>();
    const variablesMock = moq.Mock.ofType<RulesetVariablesManager>();
    const presentationManagerMock = moq.Mock.ofType<PresentationManager>();
    presentationManagerMock.setup((x) => x.rulesets()).returns(() => rulesetsMock.object);
    presentationManagerMock.setup((x) => x.vars(moq.It.isAnyString())).returns(() => variablesMock.object);
    Presentation.initialize({
      clientManagerFactory: () => presentationManagerMock.object,
    });

    const imodelTokenMock = moq.Mock.ofType<IModelRpcProps>();
    const imodelMock = moq.Mock.ofType<IModelDb>();
    sinon.stub(IModelDb, "findByKey").returns(imodelMock.object);

    const impl = new PresentationRpcImpl({ requestTimeout: 10 });
    await using([{ dispose: () => Presentation.terminate() }, impl], async (_) => {
      presentationManagerMock
        .setup(async (x) => x.getNodesCount(moq.It.isAny()))
        .callback((props: HierarchyRequestOptions<IModelDb, NodeKey>) => {
          props.diagnostics!.handler([{ scope: "1" }]);
          props.diagnostics!.handler([{ scope: "2" }]);
        })
        .returns(async () => 0);
      const response = await impl.getNodesCount(imodelTokenMock.object, { rulesetOrId: "", diagnostics: { dev: true } });
      expect(response.diagnostics).to.deep.eq([{
        scope: "1",
      }, {
        scope: "2",
      }]);
    });
  });

  it("returns diagnostics from initial call when same request is repeated multiple times", async () => {
    const rulesetsMock = moq.Mock.ofType<RulesetManager>();
    const variablesMock = moq.Mock.ofType<RulesetVariablesManager>();
    const presentationManagerMock = moq.Mock.ofType<PresentationManager>();
    presentationManagerMock.setup((x) => x.rulesets()).returns(() => rulesetsMock.object);
    presentationManagerMock.setup((x) => x.vars(moq.It.isAnyString())).returns(() => variablesMock.object);
    Presentation.initialize({
      clientManagerFactory: () => presentationManagerMock.object,
    });

    const imodelTokenMock = moq.Mock.ofType<IModelRpcProps>();
    const imodelMock = moq.Mock.ofType<IModelDb>();
    sinon.stub(IModelDb, "findByKey").returns(imodelMock.object);

    const impl = new PresentationRpcImpl({ requestTimeout: 10 });
    await using([{ dispose: () => Presentation.terminate() }, impl], async (_) => {
      let callsCount = 0;
      const result = new ResolvablePromise<number>();
      presentationManagerMock
        .setup(async (x) => x.getNodesCount(moq.It.isAny()))
        .callback((props: HierarchyRequestOptions<IModelDb, NodeKey>) => {
          props.diagnostics!.handler([{ scope: `${callsCount++}` }]);
        })
        .returns(async () => result);
      const response1 = await impl.getNodesCount(imodelTokenMock.object, { rulesetOrId: "", diagnostics: { dev: true } });
      expect(response1.statusCode).to.eq(PresentationStatus.BackendTimeout);
      await result.resolve(123);
      const response2 = await impl.getNodesCount(imodelTokenMock.object, { rulesetOrId: "", diagnostics: { dev: true } });
      expect(response2.statusCode).to.eq(PresentationStatus.Success);
      expect(response2.diagnostics).to.deep.eq([{ scope: "0" }]);
    });
  });

  describe("calls forwarding", () => {

    let testData: any;
    let defaultRpcParams: { clientId: string };
    let impl: PresentationRpcImpl;
    let stub_IModelDb_findByKey: sinon.SinonStub<[string], IModelDb>; // eslint-disable-line @typescript-eslint/naming-convention
    const presentationManagerMock = moq.Mock.ofType<PresentationManager>();
    const rulesetsMock = moq.Mock.ofType<RulesetManager>();
    const variablesMock = moq.Mock.ofType<RulesetVariablesManager>();

    beforeEach(() => {
      rulesetsMock.reset();
      variablesMock.reset();
      presentationManagerMock.reset();
      presentationManagerMock.setup((x) => x.vars(moq.It.isAnyString())).returns(() => variablesMock.object);
      presentationManagerMock.setup((x) => x.rulesets()).returns(() => rulesetsMock.object);
      Presentation.initialize({
        clientManagerFactory: () => presentationManagerMock.object,
      });
      testData = {
        imodelToken: moq.Mock.ofType<IModelRpcProps>().object,
        imodelMock: moq.Mock.ofType<IModelDb>(),
        rulesetOrId: faker.random.word(),
        pageOptions: { start: 123, size: 45 } as PageOptions,
        displayType: "sample display type",
      };
      defaultRpcParams = { clientId: faker.random.uuid() };
      stub_IModelDb_findByKey = sinon.stub(IModelDb, "findByKey").returns(testData.imodelMock.object);
      impl = new PresentationRpcImpl({ requestTimeout: 10 });
    });

    afterEach(() => {
      impl.dispose();
    });

    it("returns invalid argument status code when using invalid imodel token", async () => {
      stub_IModelDb_findByKey.resetBehavior();
      stub_IModelDb_findByKey.throws(IModelNotFoundResponse);
      const options: Paged<HierarchyRpcRequestOptions> = {
        ...defaultRpcParams,
        rulesetOrId: testData.rulesetOrId,
      };

      const response = await impl.getNodesCount(testData.imodelToken, options);
      expect(response.statusCode).to.equal(PresentationStatus.InvalidArgument);
    });

    describe("makeRequest", () => {

      // note: all RPC methods go through `makeRequest` that takes care of timeouts and throws - test that here
      // using `getNodesCount` request

      it("should return `PresentationStatus.BackendTimeout` without any result if manager request takes more than requestTimeout", async () => {
        const rpcOptions: HierarchyRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
        };
        const managerOptions: HierarchyRequestOptions<IModelDb, NodeKey> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          parentKey: undefined,
        };
        const result = new ResolvablePromise<number>();
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getNodesCount(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.be.undefined;
        expect(actualResult.statusCode).to.equal(PresentationStatus.BackendTimeout);
        await result.resolve(999);
      });

      it("should return result if `requestTimeout` is set to 0", async () => {
        impl.dispose();
        impl = new PresentationRpcImpl({ requestTimeout: 0 });
        const rpcOptions: HierarchyRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
        };
        const managerOptions: HierarchyRequestOptions<IModelDb, NodeKey> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          parentKey: undefined,
        };
        const result = new ResolvablePromise<number>();
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResultPromise = impl.getNodesCount(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();

        await result.resolve(999);

        const actualResult = await actualResultPromise;
        expect(actualResult.result).to.eq(999);
      });

      it("should forward ruleset variables to manager", async () => {
        const rpcOptions: HierarchyRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          rulesetVariables: [{ id: "test", type: VariableValueTypes.Int, value: 123 }],
        };
        const managerOptions: HierarchyRequestOptions<IModelDb, NodeKey> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          parentKey: undefined,
          rulesetVariables: rpcOptions.rulesetVariables as RulesetVariable[],
        };
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => 999)
          .verifiable();
        await impl.getNodesCount(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
      });

      it("should forward diagnostics options to manager and return diagnostics with results", async () => {
        const rpcOptions: HierarchyRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          diagnostics: {
            perf: true,
          },
        };

        const managerOptions: HierarchyRequestOptions<IModelDb, NodeKey> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          parentKey: undefined,
          diagnostics: {
            perf: true,
          } as any,
        };
        const diagnosticsResult: DiagnosticsScopeLogs[] = [{ scope: "test" }];
        presentationManagerMock.setup(async (x) => x.getNodesCount(moq.It.is((actualManagerOptions) => sinon.match(managerOptions).test(actualManagerOptions))))
          .callback((options) => { options.diagnostics.handler(diagnosticsResult); })
          .returns(async () => 999)
          .verifiable();
        const actualResult = await impl.getNodesCount(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult).to.deep.eq({
          statusCode: PresentationStatus.Success,
          result: 999,
          diagnostics: diagnosticsResult,
        });
      });

      it("should return error result if manager throws", async () => {
        const rpcOptions: HierarchyRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
        };
        const managerOptions: HierarchyRequestOptions<IModelDb, NodeKey> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          parentKey: undefined,
        };
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => {
            throw new PresentationError(PresentationStatus.Error, "test error");
          })
          .verifiable();
        const actualResult = await impl.getNodesCount(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.statusCode).to.eq(PresentationStatus.Error);
        expect(actualResult.errorMessage).to.eq("test error");
      });

      it("should return error result if manager throws and `requestTimeout` is set to 0", async () => {
        impl.dispose();
        impl = new PresentationRpcImpl({ requestTimeout: 0 });
        const rpcOptions: HierarchyRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
        };
        const managerOptions: HierarchyRequestOptions<IModelDb, NodeKey> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          parentKey: undefined,
        };
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => {
            throw new PresentationError(PresentationStatus.Error, "test error");
          })
          .verifiable();
        const actualResult = await impl.getNodesCount(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.statusCode).to.eq(PresentationStatus.Error);
        expect(actualResult.errorMessage).to.eq("test error");
      });

    });

    describe("getNodesCount", () => {

      it("calls manager for root nodes count", async () => {
        const result = 999;
        const rpcOptions: HierarchyRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
        };
        const managerOptions: HierarchyRequestOptions<IModelDb, NodeKey> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          parentKey: undefined,
        };
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getNodesCount(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.eq(result);
      });

      it("calls manager for child nodes count", async () => {
        const result = 999;
        const parentNodeKey = createRandomECInstancesNodeKey();
        const rpcOptions: HierarchyRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          parentKey: NodeKey.toJSON(parentNodeKey),
        };
        const managerOptions: HierarchyRequestOptions<IModelDb, NodeKey> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          parentKey: parentNodeKey,
        };
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getNodesCount(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.eq(result);
      });
    });

    describe("getPagedNodes", () => {

      it("calls manager for root nodes", async () => {
        const getRootNodesResult: Node[] = [createRandomECInstancesNode(), createRandomECInstancesNode(), createRandomECInstancesNode()];
        const getRootNodesCountResult = 999;
        const rpcOptions: Paged<HierarchyRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
        };
        const managerOptions: Paged<HierarchyRequestOptions<IModelDb, NodeKey>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          parentKey: undefined,
        };

        presentationManagerMock.setup(async (x) => x.getNodes(managerOptions))
          .returns(async () => getRootNodesResult)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => getRootNodesCountResult)
          .verifiable();
        const actualResult = await impl.getPagedNodes(testData.imodelToken, rpcOptions);

        presentationManagerMock.verifyAll();
        expect(actualResult.result!.items).to.deep.eq(getRootNodesResult.map(Node.toJSON));
        expect(actualResult.result!.total).to.eq(getRootNodesCountResult);
      });

      it("calls manager for child nodes", async () => {
        const getChildNodesResult: Node[] = [createRandomECInstancesNode(), createRandomECInstancesNode(), createRandomECInstancesNode()];
        const getChildNodesCountResult = 999;
        const parentNodeKey = createRandomECInstancesNodeKey();
        const rpcOptions: Paged<HierarchyRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          parentKey: NodeKey.toJSON(parentNodeKey),
        };
        const managerOptions: Paged<HierarchyRequestOptions<IModelDb, NodeKey>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          parentKey: parentNodeKey,
        };

        presentationManagerMock.setup(async (x) => x.getNodes(managerOptions))
          .returns(async () => getChildNodesResult)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => getChildNodesCountResult)
          .verifiable();
        const actualResult = await impl.getPagedNodes(testData.imodelToken, rpcOptions);

        presentationManagerMock.verifyAll();
        expect(actualResult.result!.items).to.deep.eq(getChildNodesResult.map(Node.toJSON));
        expect(actualResult.result!.total).to.eq(getChildNodesCountResult);
      });

      it("enforces maximum page size when requesting with larger size than allowed", async () => {
        const getRootNodesResult: Node[] = [];
        const getRootNodesCountResult = 9999;
        const rpcOptions: Paged<HierarchyRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: 9999 },
        };
        const managerOptions: Paged<HierarchyRequestOptions<IModelDb, NodeKey>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: MAX_ALLOWED_PAGE_SIZE },
          parentKey: undefined,
        };
        presentationManagerMock.setup(async (x) => x.getNodes(managerOptions))
          .returns(async () => getRootNodesResult)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => getRootNodesCountResult)
          .verifiable();
        await impl.getPagedNodes(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
      });

      it("enforces maximum page size when requesting with undefined size", async () => {
        const getRootNodesResult: Node[] = [];
        const getRootNodesCountResult = 9999;
        const rpcOptions: Paged<HierarchyRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0 },
        };
        const managerOptions: Paged<HierarchyRequestOptions<IModelDb, NodeKey>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: MAX_ALLOWED_PAGE_SIZE },
          parentKey: undefined,
        };
        presentationManagerMock.setup(async (x) => x.getNodes(managerOptions))
          .returns(async () => getRootNodesResult)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => getRootNodesCountResult)
          .verifiable();
        await impl.getPagedNodes(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
      });

      it("enforces maximum page size when requesting with undefined page options", async () => {
        const getRootNodesResult: Node[] = [];
        const getRootNodesCountResult = 9999;
        const rpcOptions: Paged<HierarchyRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
        };
        const managerOptions: Paged<HierarchyRequestOptions<IModelDb, NodeKey>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { size: MAX_ALLOWED_PAGE_SIZE },
          parentKey: undefined,
        };
        presentationManagerMock.setup(async (x) => x.getNodes(managerOptions))
          .returns(async () => getRootNodesResult)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getNodesCount(managerOptions))
          .returns(async () => getRootNodesCountResult)
          .verifiable();
        await impl.getPagedNodes(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
      });

    });

    describe("getFilteredNodePaths", () => {

      it("calls manager", async () => {
        const result = [createRandomNodePathElement(0), createRandomNodePathElement(0)];
        const rpcOptions: PresentationRpcRequestOptions<FilterByTextHierarchyRequestOptions<never, RulesetVariableJSON>> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          filterText: "filter",
        };
        const managerOptions: FilterByTextHierarchyRequestOptions<IModelDb> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          filterText: "filter",
        };
        presentationManagerMock.setup(async (x) => x.getFilteredNodePaths(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getFilteredNodePaths(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.equal(result.map(NodePathElement.toJSON));
      });

    });

    describe("getNodePaths", () => {

      it("calls manager", async () => {
        const result = [createRandomNodePathElement(0), createRandomNodePathElement(0)];
        const keyArray: InstanceKey[][] = [[createRandomECInstanceKey(), createRandomECInstanceKey()]];
        const rpcOptions: PresentationRpcRequestOptions<FilterByInstancePathsHierarchyRequestOptions<never, RulesetVariableJSON>> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          instancePaths: keyArray,
          markedIndex: 1,
        };
        const managerOptions: FilterByInstancePathsHierarchyRequestOptions<IModelDb> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          instancePaths: keyArray,
          markedIndex: 1,
        };
        presentationManagerMock.setup(async (x) => x.getNodePaths(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getNodePaths(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.equal(result.map(NodePathElement.toJSON));
      });

    });

    describe("getContentSources", () => {

      it("calls manager", async () => {
        const classes = ["test.class1"];
        const rpcOptions: ContentSourcesRpcRequestOptions = {
          ...defaultRpcParams,
          classes,
        };
        const managerOptions: ContentSourcesRequestOptions<IModelDb> = {
          imodel: testData.imodelMock.object,
          classes,
        };
        const managerResponse = [createTestSelectClassInfo()];
        const classesMap = {};
        const expectedResult: ContentSourcesRpcResult = {
          sources: managerResponse.map((sci) => SelectClassInfo.toCompressedJSON(sci, classesMap)),
          classesMap,
        };
        presentationManagerMock.setup(async (x) => x.getContentSources(managerOptions))
          .returns(async () => managerResponse)
          .verifiable();
        const actualResult = await impl.getContentSources(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(expectedResult);
      });

    });

    describe("getContentDescriptor", () => {

      it("calls manager", async () => {
        const keys = new KeySet();
        const descriptor = createTestContentDescriptor({ fields: [] });
        const rpcOptions: ContentDescriptorRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          displayType: testData.displayType,
          keys: keys.toJSON(),
        };
        const managerOptions: ContentDescriptorRequestOptions<IModelDb, KeySet> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          displayType: testData.displayType,
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContentDescriptor(managerOptions))
          .returns(async () => descriptor)
          .verifiable();
        const actualResult = await impl.getContentDescriptor(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(descriptor.toJSON());
      });

      it("handles undefined descriptor response", async () => {
        const keys = new KeySet();
        const rpcOptions: ContentDescriptorRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          displayType: testData.displayType,
          keys: keys.toJSON(),
        };
        const managerOptions: ContentDescriptorRequestOptions<IModelDb, KeySet> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          displayType: testData.displayType,
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContentDescriptor(managerOptions))
          .returns(async () => undefined)
          .verifiable();
        const actualResult = await impl.getContentDescriptor(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.be.undefined;
      });

    });

    describe("getContentSetSize", () => {

      it("calls manager", async () => {
        const keys = new KeySet();
        const result = 789;
        const descriptor = createTestContentDescriptor({ fields: [] });
        const rpcOptions: ContentRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          descriptor: descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          descriptor: descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock
          .setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getContentSetSize(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(result);
      });

    });

    describe("getPagedContent", () => {

      it("calls manager", async () => {
        const keys = new KeySet();
        const contentItem = new Item([], "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 999)
          .verifiable();
        const actualResult = await impl.getPagedContent(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          descriptor: content.descriptor.toJSON(),
          contentSet: {
            total: 999,
            items: content.contentSet.map((i) => i.toJSON()),
          },
        });
      });

      it("handles case when manager returns no content", async () => {
        const keys = new KeySet();
        const descriptorOverrides: DescriptorOverrides = {
          displayType: "",
          contentFlags: 0,
        };
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: descriptorOverrides,
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: descriptorOverrides,
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => undefined)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 0)
          .verifiable();
        const actualResult = await impl.getPagedContent(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.be.undefined;
      });

      it("enforces maximum page size when requesting with larger size than allowed", async () => {
        const keys = new KeySet();
        const contentItem = new Item([], "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: MAX_ALLOWED_PAGE_SIZE + 1 },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: MAX_ALLOWED_PAGE_SIZE },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 9999)
          .verifiable();
        const actualResult = await impl.getPagedContent(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          descriptor: content.descriptor.toJSON(),
          contentSet: {
            total: 9999,
            items: content.contentSet.map((i) => i.toJSON()),
          },
        });
      });

      it("enforces maximum page size when requesting with undefined size", async () => {
        const keys = new KeySet();
        const contentItem = new Item([], "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 5 },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 5, size: MAX_ALLOWED_PAGE_SIZE },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 9999)
          .verifiable();
        const actualResult = await impl.getPagedContent(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          descriptor: content.descriptor.toJSON(),
          contentSet: {
            total: 9999,
            items: content.contentSet.map((i) => i.toJSON()),
          },
        });
      });

      it("enforces maximum page size when requesting with undefined page options", async () => {
        const keys = new KeySet();
        const contentItem = new Item([], "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: undefined,
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { size: MAX_ALLOWED_PAGE_SIZE },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 9999)
          .verifiable();
        const actualResult = await impl.getPagedContent(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          descriptor: content.descriptor.toJSON(),
          contentSet: {
            total: 9999,
            items: content.contentSet.map((i) => i.toJSON()),
          },
        });
      });

    });

    describe("getPagedContentSet", () => {

      it("calls manager", async () => {
        const keys = new KeySet();
        const contentItem = new Item([], "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 999)
          .verifiable();
        const actualResult = await impl.getPagedContentSet(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 999,
          items: content.contentSet.map((i) => i.toJSON()),
        });
      });

      it("handles case when manager returns no content", async () => {
        const keys = new KeySet();
        const descriptorOverrides: DescriptorOverrides = {
          displayType: "",
          contentFlags: 0,
        };
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: descriptorOverrides,
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: descriptorOverrides,
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => undefined)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 0)
          .verifiable();
        const actualResult = await impl.getPagedContentSet(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({ total: 0, items: [] });
      });

      it("enforces maximum page size when requesting with larger size than allowed", async () => {
        const keys = new KeySet();
        const contentItem = new Item([], "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: MAX_ALLOWED_PAGE_SIZE + 1 },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: MAX_ALLOWED_PAGE_SIZE },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 9999)
          .verifiable();
        const actualResult = await impl.getPagedContentSet(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 9999,
          items: content.contentSet.map((i) => i.toJSON()),
        });
      });

      it("enforces maximum page size when requesting with undefined size", async () => {
        const keys = new KeySet();
        const contentItem = new Item([], "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 5 },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 5, size: MAX_ALLOWED_PAGE_SIZE },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 9999)
          .verifiable();
        const actualResult = await impl.getPagedContentSet(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 9999,
          items: content.contentSet.map((i) => i.toJSON()),
        });
      });

      it("enforces maximum page size when requesting with undefined page options", async () => {
        const keys = new KeySet();
        const contentItem = new Item([], "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: undefined,
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { size: MAX_ALLOWED_PAGE_SIZE },
          descriptor: content.descriptor.createDescriptorOverrides(),
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 9999)
          .verifiable();
        const actualResult = await impl.getPagedContentSet(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 9999,
          items: content.contentSet.map((i) => i.toJSON()),
        });
      });

    });

    describe("getPagedDistinctValues", () => {

      it("calls manager", async () => {
        const distinctValues = {
          total: 1,
          items: [{
            displayValue: "test",
            groupedRawValues: ["test"],
          }],
        };
        const keys = new KeySet();
        const descriptor = createTestContentDescriptor({ fields: [] });
        const fieldDescriptor: FieldDescriptor = {
          type: FieldDescriptorType.Name,
          fieldName: "test",
        };
        const managerOptions: DistinctValuesRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet> = {
          rulesetOrId: testData.rulesetOrId,
          imodel: testData.imodelMock.object,
          descriptor: descriptor.createDescriptorOverrides(),
          fieldDescriptor,
          keys,
          paging: testData.pageOptions,
        };
        const rpcOptions: DistinctValuesRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: managerOptions.rulesetOrId,
          descriptor: descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
          fieldDescriptor: managerOptions.fieldDescriptor,
          paging: testData.pageOptions,
        };
        presentationManagerMock.setup(async (x) => x.getPagedDistinctValues(managerOptions))
          .returns(async () => distinctValues)
          .verifiable();
        const actualResult = await impl.getPagedDistinctValues(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(distinctValues);
      });

      it("enforces maximum page size when requesting with larger size than allowed", async () => {
        const distinctValues = {
          total: 1,
          items: [{
            displayValue: "test",
            groupedRawValues: ["test"],
          }],
        };
        const keys = new KeySet();
        const descriptor = createTestContentDescriptor({ fields: [] });
        const fieldDescriptor: FieldDescriptor = {
          type: FieldDescriptorType.Name,
          fieldName: "test",
        };
        const managerOptions: DistinctValuesRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet> = {
          rulesetOrId: testData.rulesetOrId,
          imodel: testData.imodelMock.object,
          descriptor: descriptor.createDescriptorOverrides(),
          fieldDescriptor,
          keys,
          paging: { start: 0, size: MAX_ALLOWED_PAGE_SIZE },
        };
        const rpcOptions: DistinctValuesRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: managerOptions.rulesetOrId,
          descriptor: descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
          fieldDescriptor: managerOptions.fieldDescriptor,
          paging: { start: 0, size: MAX_ALLOWED_PAGE_SIZE + 1 },
        };
        presentationManagerMock.setup(async (x) => x.getPagedDistinctValues(managerOptions))
          .returns(async () => distinctValues)
          .verifiable();
        const actualResult = await impl.getPagedDistinctValues(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(distinctValues);
      });

      it("enforces maximum page size when requesting with undefined size", async () => {
        const distinctValues = {
          total: 1,
          items: [{
            displayValue: "test",
            groupedRawValues: ["test"],
          }],
        };
        const keys = new KeySet();
        const descriptor = createTestContentDescriptor({ fields: [] });
        const fieldDescriptor: FieldDescriptor = {
          type: FieldDescriptorType.Name,
          fieldName: "test",
        };
        const managerOptions: DistinctValuesRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet> = {
          rulesetOrId: testData.rulesetOrId,
          imodel: testData.imodelMock.object,
          descriptor: descriptor.createDescriptorOverrides(),
          fieldDescriptor,
          keys,
          paging: { start: 5, size: MAX_ALLOWED_PAGE_SIZE },
        };
        const rpcOptions: DistinctValuesRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: managerOptions.rulesetOrId,
          descriptor: descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
          fieldDescriptor: managerOptions.fieldDescriptor,
          paging: { start: 5 },
        };
        presentationManagerMock.setup(async (x) => x.getPagedDistinctValues(managerOptions))
          .returns(async () => distinctValues)
          .verifiable();
        const actualResult = await impl.getPagedDistinctValues(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(distinctValues);
      });

      it("enforces maximum page size when requesting with undefined page options", async () => {
        const distinctValues = {
          total: 1,
          items: [{
            displayValue: "test",
            groupedRawValues: ["test"],
          }],
        };
        const keys = new KeySet();
        const descriptor = createTestContentDescriptor({ fields: [] });
        const fieldDescriptor: FieldDescriptor = {
          type: FieldDescriptorType.Name,
          fieldName: "test",
        };
        const managerOptions: DistinctValuesRequestOptions<IModelDb, Descriptor | DescriptorOverrides, KeySet> = {
          rulesetOrId: testData.rulesetOrId,
          imodel: testData.imodelMock.object,
          descriptor: descriptor.createDescriptorOverrides(),
          fieldDescriptor,
          keys,
          paging: { size: MAX_ALLOWED_PAGE_SIZE },
        };
        const rpcOptions: DistinctValuesRpcRequestOptions = {
          ...defaultRpcParams,
          rulesetOrId: managerOptions.rulesetOrId,
          descriptor: descriptor.createDescriptorOverrides(),
          keys: keys.toJSON(),
          fieldDescriptor: managerOptions.fieldDescriptor,
          paging: undefined,
        };
        presentationManagerMock.setup(async (x) => x.getPagedDistinctValues(managerOptions))
          .returns(async () => distinctValues)
          .verifiable();
        const actualResult = await impl.getPagedDistinctValues(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(distinctValues);
      });

    });

    describe("getElementProperties", () => {

      it("calls manager", async () => {
        const testElementProperties: ElementProperties = {
          class: "Test Class",
          id: "0x123",
          label: "test label",
          items: {
            ["Test Category"]: {
              type: "category",
              items: {
                ["Test Field"]: {
                  type: "primitive",
                  value: "test display value",
                },
              },
            },
          },
        };
        const managerOptions: SingleElementPropertiesRequestOptions<IModelDb> = {
          imodel: testData.imodelMock.object,
          elementId: "0x123",
        };
        const managerResponse = testElementProperties;
        const rpcOptions: PresentationRpcRequestOptions<SingleElementPropertiesRpcRequestOptions> = {
          ...defaultRpcParams,
          elementId: "0x123",
        };
        const expectedRpcResponse = testElementProperties;
        presentationManagerMock
          .setup(async (x) => x.getElementProperties(managerOptions))
          .returns(async () => managerResponse)
          .verifiable();
        const actualResult = await impl.getElementProperties(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(expectedRpcResponse);
      });

    });

    describe("getContentInstanceKeys", () => {

      it("calls manager", async () => {
        const keys = new KeySet();
        const contentItemKeys = [createTestECInstanceKey({ id: "0x123" }), createTestECInstanceKey({ id: "0x456" })];
        const contentItem = new Item(contentItemKeys, "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentInstanceKeysRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          displayType: content.descriptor.displayType,
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, DescriptorOverrides, KeySet, RulesetVariable>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: {
            displayType: content.descriptor.displayType,
            contentFlags: ContentFlags.KeysOnly,
          },
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 999)
          .verifiable();
        const actualResult = await impl.getContentInstanceKeys(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 999,
          items: new KeySet(contentItemKeys).toJSON(),
        });
      });

      it("handles case when manager returns no content", async () => {
        const keys = new KeySet();
        const rpcOptions: Paged<ContentInstanceKeysRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, DescriptorOverrides, KeySet, RulesetVariable>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: testData.pageOptions,
          descriptor: {
            displayType: undefined,
            contentFlags: ContentFlags.KeysOnly,
          },
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => undefined)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 0)
          .verifiable();
        const actualResult = await impl.getContentInstanceKeys(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 0,
          items: new KeySet().toJSON(),
        });
      });

      it("enforces maximum page size when requesting with larger size than allowed", async () => {
        const keys = new KeySet();
        const contentItemKeys = [createTestECInstanceKey()];
        const contentItem = new Item(contentItemKeys, "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentInstanceKeysRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: MAX_ALLOWED_KEYS_PAGE_SIZE + 1 },
          displayType: content.descriptor.displayType,
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, DescriptorOverrides, KeySet, RulesetVariable>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 0, size: MAX_ALLOWED_KEYS_PAGE_SIZE },
          descriptor: {
            displayType: content.descriptor.displayType,
            contentFlags: ContentFlags.KeysOnly,
          },
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 999)
          .verifiable();
        const actualResult = await impl.getContentInstanceKeys(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 999,
          items: new KeySet(contentItemKeys).toJSON(),
        });
      });

      it("enforces maximum page size when requesting with undefined size", async () => {
        const keys = new KeySet();
        const contentItemKeys = [createTestECInstanceKey()];
        const contentItem = new Item(contentItemKeys, "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentInstanceKeysRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 123 },
          displayType: content.descriptor.displayType,
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, DescriptorOverrides, KeySet, RulesetVariable>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { start: 123, size: MAX_ALLOWED_KEYS_PAGE_SIZE },
          descriptor: {
            displayType: content.descriptor.displayType,
            contentFlags: ContentFlags.KeysOnly,
          },
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 999)
          .verifiable();
        const actualResult = await impl.getContentInstanceKeys(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 999,
          items: new KeySet(contentItemKeys).toJSON(),
        });
      });

      it("enforces maximum page size when requesting with undefined page options", async () => {
        const keys = new KeySet();
        const contentItemKeys = [createTestECInstanceKey()];
        const contentItem = new Item(contentItemKeys, "", "", undefined, {}, {}, [], undefined);
        const content = new Content(createTestContentDescriptor({ fields: [] }), [contentItem]);
        const rpcOptions: Paged<ContentInstanceKeysRpcRequestOptions> = {
          ...defaultRpcParams,
          rulesetOrId: testData.rulesetOrId,
          displayType: content.descriptor.displayType,
          keys: keys.toJSON(),
        };
        const managerOptions: Paged<ContentRequestOptions<IModelDb, DescriptorOverrides, KeySet, RulesetVariable>> = {
          imodel: testData.imodelMock.object,
          rulesetOrId: testData.rulesetOrId,
          paging: { size: MAX_ALLOWED_KEYS_PAGE_SIZE },
          descriptor: {
            displayType: content.descriptor.displayType,
            contentFlags: ContentFlags.KeysOnly,
          },
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getContent(managerOptions))
          .returns(async () => content)
          .verifiable();
        presentationManagerMock.setup(async (x) => x.getContentSetSize(managerOptions))
          .returns(async () => 999)
          .verifiable();
        const actualResult = await impl.getContentInstanceKeys(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({
          total: 999,
          items: new KeySet(contentItemKeys).toJSON(),
        });
      });

    });

    describe("getDisplayLabelDefinition", () => {

      it("calls manager", async () => {
        const result = createRandomLabelDefinitionJSON();
        const key = createRandomECInstanceKey();
        const rpcOptions: Paged<DisplayLabelRpcRequestOptions> = {
          ...defaultRpcParams,
          paging: testData.pageOptions,
          key: InstanceKey.toJSON(key),
        };
        const managerOptions: Paged<DisplayLabelRequestOptions<IModelDb, InstanceKey>> = {
          imodel: testData.imodelMock.object,
          paging: testData.pageOptions,
          key,
        };
        presentationManagerMock.setup(async (x) => x.getDisplayLabelDefinition(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getDisplayLabelDefinition(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(result);
      });

    });

    describe("getPagedDisplayLabelDefinitions", () => {

      it("calls manager", async () => {
        const result = [createRandomLabelDefinitionJSON(), createRandomLabelDefinitionJSON()];
        const keys = [createRandomECInstanceKey(), createRandomECInstanceKey()];
        const rpcOptions: DisplayLabelsRpcRequestOptions = {
          ...defaultRpcParams,
          keys: keys.map(InstanceKey.toJSON),
        };
        const managerOptions: DisplayLabelsRequestOptions<IModelDb, InstanceKey> = {
          imodel: testData.imodelMock.object,
          keys,
        };
        presentationManagerMock.setup(async (x) => x.getDisplayLabelDefinitions(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getPagedDisplayLabelDefinitions(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({ total: 2, items: result });
      });

      it("enforces maximum page size when requesting more labels than allowed", async () => {
        const result = (new Array(MAX_ALLOWED_PAGE_SIZE)).fill(createRandomLabelDefinitionJSON());
        const keys = (new Array(MAX_ALLOWED_PAGE_SIZE + 1)).fill(createRandomECInstanceKey());
        const rpcOptions: DisplayLabelsRpcRequestOptions = {
          ...defaultRpcParams,
          keys: keys.map(InstanceKey.toJSON),
        };
        const managerOptions: DisplayLabelsRequestOptions<IModelDb, InstanceKey> = {
          imodel: testData.imodelMock.object,
          keys: keys.slice(0, MAX_ALLOWED_PAGE_SIZE),
        };
        presentationManagerMock.setup(async (x) => x.getDisplayLabelDefinitions(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getPagedDisplayLabelDefinitions(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq({ total: MAX_ALLOWED_PAGE_SIZE, items: result });
      });

    });

    describe("getSelectionScopes", () => {

      it("calls manager", async () => {
        const rpcOptions: PresentationRpcRequestOptions<SelectionScopeRequestOptions<never>> = {
          ...defaultRpcParams,
        };
        const managerOptions: SelectionScopeRequestOptions<IModelDb> = {
          imodel: testData.imodelMock.object,
        };
        const result = [createRandomSelectionScope()];
        presentationManagerMock.setup(async (x) => x.getSelectionScopes(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.getSelectionScopes(testData.imodelToken, rpcOptions);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(result);
      });

    });

    describe("computeSelection", () => {

      it("calls manager", async () => {
        const scope = createRandomSelectionScope();
        const ids = [createRandomId()];
        const rpcOptions: PresentationRpcRequestOptions<SelectionScopeRequestOptions<never>> = {
          ...defaultRpcParams,
        };
        const managerOptions: SelectionScopeRequestOptions<IModelDb> & { ids: Id64String[], scopeId: string } = {
          imodel: testData.imodelMock.object,
          ids,
          scopeId: scope.id,
        };
        const result = new KeySet();
        presentationManagerMock.setup(async (x) => x.computeSelection(managerOptions))
          .returns(async () => result)
          .verifiable();
        const actualResult = await impl.computeSelection(testData.imodelToken, rpcOptions, ids, scope.id);
        presentationManagerMock.verifyAll();
        expect(actualResult.result).to.deep.eq(result.toJSON());
      });

    });

  });

});
