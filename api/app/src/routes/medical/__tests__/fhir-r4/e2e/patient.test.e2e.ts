import * as dotenv from "dotenv";
dotenv.config({ path: ".env.test" });
// Keep dotenv import and config before everything else
import { AxiosResponse } from "axios";
import { v4 as uuidv4 } from "uuid";
import { makeFhirAdminApi } from "../../../../../external/fhir/api/api-factory";
import { makeOrgNumber } from "../../../../../models/medical/__tests__/organization";
import { api } from "../../../../__tests__/shared";
import { makePatient } from "./patient";

const patient = makePatient();
const organizationNumber = makeOrgNumber();
const cxId = uuidv4();
const fhirClient = makeFhirAdminApi();

beforeAll(async () => {
  await fhirClient.createTenant({ organizationNumber, cxId });
});
afterAll(async () => {
  await fhirClient.deleteTenant({ organizationNumber });
});

describe("Integration FHIR Patient", () => {
  test("create patient", async () => {
    const res = await api.put(`/fhir/R4/Patient/${patient.id}`, patient);
    expect(res.status).toBe(201);
    expect(res.data).toBeTruthy();
    validatePatient(res.data);
  });

  test("get patient", async () => {
    const res = await api.get(`/fhir/R4/Patient/${patient.id}`);
    expect(res.status).toBe(200);
    expect(res.data).toBeTruthy();
    validatePatient(res.data);
  });

  test("search patient by name", async () => {
    const res = await api.get(`/fhir/R4/Patient/?name=${patient.name[0].given[0]}`);
    expect(res.status).toBe(200);
    const body = res.data;
    expect(body.resourceType).toBeTruthy();
    expect(body.resourceType).toBe("Bundle");
    expect(body.entry).toBeTruthy();
    expect(body.entry.length).toEqual(1);
    const entry = body.entry[0];
    expect(entry).toBeTruthy();
    expect(entry.resource).toBeTruthy();
    expect(entry.resource.id).toEqual(patient.id);
    expect(entry.resource.name).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          given: patient.name[0].given,
          family: patient.name[0].family,
          use: patient.name[0].use,
        }),
      ])
    );
  });

  describe(`delete`, () => {
    test("delete patient", async () => {
      const res = await api.delete(`/fhir/R4/Patient/${patient.id}`);
      validateDeleteResponse(res, "SUCCESSFUL_DELETE");
    });

    test("sequential delete patient", async () => {
      const res = await api.delete(`/fhir/R4/Patient/${patient.id}`);
      validateDeleteResponse(res, "SUCCESSFUL_DELETE_ALREADY_DELETED");
    });
  });
});

//eslint-disable-next-line @typescript-eslint/no-explicit-any
function validatePatient(body: any) {
  expect(body.resourceType).toBeTruthy();
  expect(body.resourceType).toBe("Patient");
  expect(body.id).toBeTruthy();
  expect(body.id).toBe(patient.id);
  expect(body.identifier).toBeTruthy();
  expect(body.identifier.length).toBeTruthy();
  expect(body.identifier[0]).toEqual(patient.identifier[0]);
  // Could validate more data here
}

function validateDeleteResponse(res: AxiosResponse, expectedResponse: string) {
  expect(res.status).toBe(200);
  const body = res.data;
  expect(body.resourceType).toBeTruthy();
  expect(body.resourceType).toBe("OperationOutcome");
  expect(body.issue).toBeTruthy();
  expect(body.issue.length).toEqual(1);
  const issue = body.issue[0];
  expect(issue.details).toBeTruthy();
  expect(issue.details.coding).toBeTruthy();
  expect(issue.details.coding.length).toEqual(1);
  const coding = issue.details.coding[0];
  expect(coding.code).toEqual(expectedResponse);
}
