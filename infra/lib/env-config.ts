import { EnvType } from "./env-type";

export type ConnectWidgetConfig = {
  stackName: string;
  region: string;
  subdomain: string;
  host: string;
  domain: string;
};

export type EnvConfig = {
  stackName: string;
  secretsStackName: string;
  region: string;
  secretReplicaRegion?: string;
  host: string; // DNS Zone
  domain: string; // Base domain
  subdomain: string; // API subdomain
  authSubdomain: string; // Authentication subdomain
  dbName: string;
  dbUsername: string;
  usageReportUrl?: string;
  fhirServerUrl?: string;
  systemRootOID: string;
  medicalDocumentsBucketName?: string;
  cdaToVisualizationLambdaName?: string;
  fhirConverterBucketName?: string;
  analyticsSecretNames?: {
    POST_HOG_API_KEY: string;
  };
  commonwell: {
    CW_MEMBER_NAME: string;
    CW_MEMBER_OID: string;
    CW_GATEWAY_ENDPOINT: string;
    CW_GATEWAY_AUTHORIZATION_SERVER_ENDPOINT: string;
    CW_TECHNICAL_CONTACT_NAME: string;
    CW_TECHNICAL_CONTACT_TITLE: string;
    CW_TECHNICAL_CONTACT_EMAIL: string;
    CW_TECHNICAL_CONTACT_PHONE: string;
  };
  providerSecretNames: {
    CRONOMETER_CLIENT_ID: string;
    CRONOMETER_CLIENT_SECRET: string;
    DEXCOM_CLIENT_ID: string;
    DEXCOM_CLIENT_SECRET: string;
    FITBIT_CLIENT_ID: string;
    FITBIT_CLIENT_SECRET: string;
    GARMIN_CONSUMER_KEY: string;
    GARMIN_CONSUMER_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    OURA_CLIENT_ID: string;
    OURA_CLIENT_SECRET: string;
    WITHINGS_CLIENT_ID: string;
    WITHINGS_CLIENT_SECRET: string;
    WHOOP_CLIENT_ID: string;
    WHOOP_CLIENT_SECRET: string;
  };
  cwSecretNames: {
    CW_PRIVATE_KEY: string;
    CW_CERTIFICATE: string;
    CW_MEMBER_PRIVATE_KEY: string;
    CW_MEMBER_CERTIFICATE: string;
    CW_GATEWAY_AUTHORIZATION_CLIENT_ID: string;
    CW_GATEWAY_AUTHORIZATION_CLIENT_SECRET: string;
  };
  sentryDSN?: string; // API's Sentry DSN
  lambdasSentryDSN?: string;
  slack?: {
    SLACK_ALERT_URL?: string;
    SLACK_NOTIFICATION_URL?: string;
    workspaceId: string;
    alertsChannelId: string;
  };
} & (
  | {
      environmentType: EnvType.staging | EnvType.production;
      connectWidget: ConnectWidgetConfig;
      connectWidgetUrl?: never;
    }
  | {
      environmentType: EnvType.sandbox;
      connectWidget?: never;
      connectWidgetUrl: string;
    }
);
