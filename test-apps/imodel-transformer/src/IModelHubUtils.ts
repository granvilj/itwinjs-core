/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
// cspell:words buddi urlps

import { AccessToken, assert, GuidString } from "@itwin/core-bentley";
import { ElectronMainAuthorization } from "@itwin/electron-authorization/lib/cjs/ElectronMain";
import { AccessTokenAdapter, BackendIModelsAccess } from "@itwin/imodels-access-backend";
import { BriefcaseDb, BriefcaseManager, IModelHost, IModelHostConfiguration, RequestNewBriefcaseArg } from "@itwin/core-backend";
import { BriefcaseIdValue, ChangesetId, ChangesetIndex, ChangesetProps } from "@itwin/core-common";
import { ElectronHost } from "@itwin/core-electron/lib/cjs/ElectronBackend";
import { IModelsClient, NamedVersion } from "@itwin/imodels-client-authoring";

export class IModelTransformerTestAppHost {
  public static iModelClient?: IModelsClient;

  public static async startup(): Promise<void> {
    const iModelHost = new IModelHostConfiguration();
    IModelTransformerTestAppHost.iModelClient = new IModelsClient({ api: { baseUrl: `https://${process.env.IMJS_URL_PREFIX ?? ""}api.bentley.com/imodels`}});
    iModelHost.hubAccess = new BackendIModelsAccess(IModelTransformerTestAppHost.iModelClient);

    const opt = {
      electronHost: {
        developmentServer: process.env.NODE_ENV === "development",
      },
      nativeHost: {
        applicationName: "imodel-transformer-test-app",
      },
      iModelHost,
    };

    await ElectronHost.startup(opt);
  }

  private static _authClient: ElectronMainAuthorization | undefined;

  /** Similar to get `IModelHost.authorizationClient.getAccessToken()` but lazily
   * initializes auth, so users aren't prompted to sign in unless a hub-accessing feature is used.
   * If we didn't do it lazily, we'd have to sign in conditionally ahead of time which makes
   * it difficult for typescript to reason about whether the accessToken is valid or not
   */
  public static async acquireAccessToken(): Promise<AccessToken> {
    if (!this._authClient) {
      assert(
        process.env.IMJS_OIDC_ELECTRON_TEST_CLIENT_ID !== undefined,
        "An online-only interaction was requested, but the required environment variables haven't been configured\n"
        + "Please see the .env.template file on how to set up environment variables."
      );
      return new Promise<AccessToken>(async (resolve, reject) => {
        const client = await ElectronMainAuthorization.create({
          clientId: process.env.IMJS_OIDC_ELECTRON_TEST_CLIENT_ID ?? "",
          redirectUri: process.env.IMJS_OIDC_ELECTRON_TEST_REDIRECT_URI ?? "",
          scope: process.env.IMJS_OIDC_ELECTRON_TEST_SCOPES ?? "",
        });
        this._authClient = client;

        ElectronMainAuthorization.onUserStateChanged.addOnce((token) => {
          if (token !== "") {
            resolve(token);
          } else {
            reject(new Error("Failed to sign in"));
          }
        });
        this._authClient.signIn().catch((err) => reject(err));
      });
    }
    return this._authClient.getAccessToken();
  }
}

export namespace IModelHubUtils {
  export function setHubEnvironment(arg?: string): void {
    process.env.IMJS_URL_PREFOX = `${"prod" === arg ? "" : arg}-`;
  }

  export async function queryIModelId(accessToken: AccessToken, iTwinId: GuidString, iModelName: string): Promise<GuidString | undefined> {
    return IModelHost.hubAccess.queryIModelByName({ accessToken, iTwinId, iModelName });
  }

  /** Temporarily needed to convert from the now preferred ChangesetIndex to the legacy ChangesetId.
   * @note This function should be removed when full support for ChangesetIndex is in place.
   */
  export async function queryChangesetId(accessToken: AccessToken, iModelId: GuidString, changesetIndex: ChangesetIndex): Promise<ChangesetId> {
    return (await IModelHost.hubAccess.queryChangeset({ accessToken, iModelId, changeset: { index: changesetIndex } })).id;
  }

  /** Temporarily needed to convert from the legacy ChangesetId to the now preferred ChangeSetIndex.
   * @note This function should be removed when full support for ChangesetIndex is in place.
   */
  export async function queryChangesetIndex(accessToken: AccessToken, iModelId: GuidString, changesetId: ChangesetId): Promise<ChangesetIndex> {
    return (await IModelHost.hubAccess.queryChangeset({ accessToken, iModelId, changeset: { id: changesetId } })).index;
  }

  /** Call the specified function for each changeset of the specified iModel. */
  export async function forEachChangeset(accessToken: AccessToken, iModelId: GuidString, func: (c: ChangesetProps) => void): Promise<void> {
    const changesets = await IModelHost.hubAccess.queryChangesets({ accessToken, iModelId });
    for (const changeset of changesets) {
      func(changeset);
    }
  }

  /** Call the specified function for each (named) Version of the specified iModel. */
  export async function forEachNamedVersion(accessToken: AccessToken, iModelId: GuidString, func: (v: NamedVersion) => void): Promise<void> {
    if (!IModelTransformerTestAppHost.iModelClient)
      throw new Error("IModelTransformerTestAppHost.startup has not been called.");

    for await (const namedVersion of IModelTransformerTestAppHost.iModelClient.namedVersions.getRepresentationList({iModelId, authorization: AccessTokenAdapter.toAuthorizationCallback(accessToken)})) {
      func(namedVersion);
    }
  }

  export async function downloadAndOpenBriefcase(briefcaseArg: RequestNewBriefcaseArg): Promise<BriefcaseDb> {
    const briefcaseProps = await BriefcaseManager.downloadBriefcase(briefcaseArg);
    return BriefcaseDb.open({
      fileName: briefcaseProps.fileName,
      readonly: briefcaseArg.briefcaseId ? briefcaseArg.briefcaseId === BriefcaseIdValue.Unassigned : false,
    });
  }
}
