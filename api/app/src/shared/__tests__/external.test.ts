import { decodeExternalId, encodeExternalId } from "../external";

describe("mapi external", () => {
  describe("encode and decode external IDs", () => {
    const MAX_FHIR_ID_LENGTH = 64;

    const idsToTest = [
      "2.16.840.1.113883.3.107.100.1.3.252.1.00805946.896751", // https://metriport.slack.com/archives/C04DBBJSKGB/p1684107884991659?thread_ts=1684105959.041439&cid=C04DBBJSKGB
      "2.16.840.1.113883.3.107^100", // https://metriport.slack.com/archives/C04DBBJSKGB/p1684109280912069?thread_ts=1684105959.041439&cid=C04DBBJSKGB
      "1.2.840.114350.1.13.325.2.7.8.688883.379834396",
      "C5CD8A63-352F-4BCF-9ECA-92D7937CCFE5", // UUID v4
      "-M-B61C405F-EAF8-486B-8DD2-F9F32F684F09", // with non-hl7 prefix
      "urn:oid:1.2.840.114350.1.13.297.2.7.8.688883.1861863824",
      "urn:oid:1.2.840.114350.1.13.297.2.7.8.688883.1957700655",
      "urn:uuid:dc63224e-f707-463e-926d-fa43150da209_1.pdf",
      "urn:oid:2.25.4108969948708843699400070490184568710081",
      "urn:oid:2.25.3256622045398803408302098767778408581025",
      "urn:oid:1.3.6.1.4.1.22812.3.8196701.3.42269.9722163889.7998",
      "2.16.840.1.113883.3.1687.1.999362^55902552",
      "2.16.840.1.113883.3.1110^f7d1a909-74cc-4ad9-8c0c-ba5b9979234f",
      "1.2.840.114350.1.13.436.2.7.8.688883.504872219",
      "9017481117802040^2019-07-30T17:10:41Z",
      "2.25.262919339841744742006694556787834680490",
      "DCCD8116-7F3D-BBDA-8379-7FDBCCB115E7",
    ];

    describe("encode and decode", () => {
      for (const decoded of idsToTest) {
        it(`encode/decode ID ${decoded}`, async () => {
          const encoded = encodeExternalId(decoded);
          expect(encoded).toBeTruthy();
          const res = decodeExternalId(encoded);
          expect(res).toEqual(decoded);
        });
      }
    });

    describe("encode within length limit", () => {
      for (const decoded of idsToTest) {
        it(`encode within limit ID ${decoded}`, async () => {
          const encoded = encodeExternalId(decoded);
          expect(encoded).toBeTruthy();
          expect(encoded.length).toBeLessThanOrEqual(MAX_FHIR_ID_LENGTH);
        });
      }
    });
  });
});
