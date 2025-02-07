import Axios from "axios";
import dayjs from "dayjs";
import { nanoid } from "nanoid";
import url from "node:url";
import oauthSignature from "oauth-signature";
import { z } from "zod";
import { updateProviderData } from "../command/connected-user/save-connected-user";
import { getUserToken, getUserTokenByUAT } from "../command/cx-user/get-user-token";
import { saveUserToken } from "../command/cx-user/save-user-token";
import { UserToken } from "../domain/user-token";
import { Config } from "../shared/config";
import { ProviderOAuth1Options } from "../shared/constants";
import { capture } from "../shared/notifications";
import { Util } from "../shared/util";

const axios = Axios.create();

export const oauthUserTokenResponse = z.object({
  oauth_token: z.string(),
  oauth_token_secret: z.string(),
});

export interface OAuth1 {
  processStep1(userToken: string): Promise<string>;
  processStep2(
    userToken: UserToken,
    oauth_verifier: string
  ): Promise<{
    userAccessToken: string;
    userAccessTokenSecret: string;
  }>;
  deregister(userAccessTokens: string[]): Promise<void>;
}

export class OAuth1DefaultImpl implements OAuth1 {
  constructor(
    private readonly providerName: ProviderOAuth1Options,
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    private readonly userApproveUrl: string,
    private readonly requestTokenUrl: string,
    private readonly requestAccessUrl: string
  ) {}

  /**
   * Called to generate the URL where user will be asked to authorize access
   */
  async processStep1(token: string): Promise<string> {
    const userToken = await getUserToken({ token });
    // connect to provider to obtain token and secret for URL that'll be sent to user
    const { oauth_token, oauth_token_secret } = await this.getTokenAndSecret(this.requestTokenUrl);
    // store the info on DynamoDB for the next steps
    const updatedUserToken = userToken.clone();
    updatedUserToken.oauthRequestToken = oauth_token;
    updatedUserToken.oauthRequestSecret = oauth_token_secret;
    await saveUserToken(updatedUserToken);
    // build the authorization URL for the user
    const callbackUrl =
      Config.getConnectRedirectUrl() + `/${this.providerName}/?state=${userToken.token}`;
    return `${this.userApproveUrl}?oauth_token=${oauth_token}&oauth_callback=${callbackUrl}`;
  }

  /**
   * Called after the user authorizes access.
   */
  async processStep2(
    userToken: UserToken,
    oauth_verifier: string
  ): Promise<{
    userAccessToken: string;
    userAccessTokenSecret: string;
  }> {
    const oauth_token = userToken.oauthRequestToken;
    const oauth_token_secret = userToken.oauthRequestSecret;
    if (!oauth_token || !oauth_token_secret) {
      throw new Error(`Missing token/secret for token ${userToken.token}`);
    }
    // connect to the provider to obtain the access token and secret
    const tokenAndSecret = await this.getTokenAndSecret(this.requestAccessUrl, {
      oauth_token,
      oauth_token_secret,
      oauth_verifier,
    });
    const { oauth_token: userAccessToken, oauth_token_secret: userAccessTokenSecret } =
      tokenAndSecret;
    // store the info on DynamoDB so we can identify webhook calls with the UAT
    const updatedUserToken = userToken.clone();
    updatedUserToken.oauthUserAccessToken = userAccessToken;
    updatedUserToken.oauthUserAccessSecret = userAccessTokenSecret;
    await saveUserToken(updatedUserToken);

    return {
      userAccessToken,
      userAccessTokenSecret,
    };
  }

  private async getTokenAndSecret(
    requestUrl: string,
    step2Data?: {
      oauth_token: string;
      oauth_verifier: string;
      oauth_token_secret: string;
    }
  ): Promise<{
    oauth_token: string;
    oauth_token_secret: string;
  }> {
    const log = Util.log("[OAuth1.getTokenAndSecret]");
    const oauth_signature_method = "HMAC-SHA1";
    const oauth_consumer_key = this.consumerKey;
    const oauth_nonce = nanoid();
    const oauth_timestamp = dayjs().unix();
    const oauth_version = "1.0";
    const baseParams = {
      oauth_signature_method,
      oauth_consumer_key,
      oauth_nonce,
      oauth_timestamp,
      oauth_version,
      ...(step2Data
        ? {
            oauth_token: step2Data.oauth_token,
            oauth_verifier: step2Data.oauth_verifier,
          }
        : undefined),
    };
    const oauth_signature = oauthSignature.generate(
      "POST",
      requestUrl,
      baseParams,
      this.consumerSecret,
      step2Data ? step2Data.oauth_token_secret : undefined
    );
    const headers = {
      Authorization:
        "OAuth " +
        `oauth_nonce=${oauth_nonce}, ` +
        `oauth_signature=${oauth_signature}, ` +
        `oauth_consumer_key=${oauth_consumer_key}, ` +
        `oauth_timestamp=${oauth_timestamp}, ` +
        `oauth_signature_method=${oauth_signature_method}, ` +
        `oauth_version=${oauth_version}` +
        (step2Data
          ? `, oauth_token=${step2Data.oauth_token}, ` +
            `oauth_verifier=${step2Data.oauth_verifier}`
          : ""),
    };

    const res = await axios.post(requestUrl, undefined, { headers });

    if (res.status > 200 || res.status >= 300) {
      const msg = `Could not generate OAuth1 URL - status ${res.status}`;
      log(`${msg}: ${res.statusText}`);
      throw new Error(msg);
    }

    // use 'url' to parse the response from format "oauth_token=<oauth_token>&oauth_token_secret=<oauth_token_secret>"
    const parsed = url.parse(`http://test.com?${res.data}`, true);
    const { oauth_token, oauth_token_secret } = oauthUserTokenResponse.parse(parsed.query);
    return { oauth_token, oauth_token_secret };
  }

  async deregister(userAccessTokens: string[]): Promise<void> {
    for (const oauthUserAccessToken of userAccessTokens) {
      const userTokenList = await getUserTokenByUAT({ oauthUserAccessToken });
      for (const userToken of userTokenList) {
        capture.setUser({ id: userToken.userId });
        // DynamoDB (Webhook and auth)
        const updatedUserToken = userToken.clone();
        updatedUserToken.oauthUserAccessToken = undefined;
        updatedUserToken.oauthUserAccessSecret = undefined;
        await saveUserToken(updatedUserToken);
        // Postgres (app standard)
        await updateProviderData({
          id: userToken.userId,
          cxId: userToken.cxId,
          provider: this.providerName,
          providerItem: undefined,
        });
      }
    }
  }
}
