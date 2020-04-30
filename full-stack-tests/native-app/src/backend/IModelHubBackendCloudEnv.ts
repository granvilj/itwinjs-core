/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { IModelCloudEnvironment, IModelHubClient } from "@bentley/imodelhub-client";
import { AzureFileHandler } from "@bentley/backend-itwin-client";
import { ContextRegistryClientWrapper } from "../common/ContextRegistryClientWrapper";
import { IModelHubUserMgr } from "../common/IModelHubUserMgr";
import { UserInfo } from "@bentley/itwin-client";

export class IModelHubBackendCloudEnv implements IModelCloudEnvironment {
  public get isIModelHub(): boolean { return true; }
  public readonly contextMgr = new ContextRegistryClientWrapper();
  public readonly imodelClient = new IModelHubClient(new AzureFileHandler());
  public async startup(): Promise<void> { return Promise.resolve(); }
  public async shutdown(): Promise<number> { return Promise.resolve(0); }

  public getAuthorizationClient(userInfo: UserInfo | undefined, userCredentials: any) {
    return new IModelHubUserMgr(userInfo, userCredentials);
  }
}
