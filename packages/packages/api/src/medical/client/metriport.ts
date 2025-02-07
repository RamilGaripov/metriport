import axios, { AxiosInstance, AxiosStatic, CreateAxiosDefaults } from "axios";
import {
  API_KEY_HEADER,
  BASE_ADDRESS,
  BASE_ADDRESS_SANDBOX,
  DEFAULT_AXIOS_TIMEOUT_MILLIS,
} from "../../shared";
import { getETagHeader } from "../models/common/base-update";
import {
  DocumentList,
  documentListSchema,
  DocumentQuery,
  documentQuerySchema,
} from "../models/document";
import { Facility, FacilityCreate, facilityListSchema, facilitySchema } from "../models/facility";
import { MedicalDataSource, PatientLinks, patientLinksSchema } from "../models/link";
import { Organization, OrganizationCreate, organizationSchema } from "../models/organization";
import {
  Patient,
  PatientCreate,
  patientListSchema,
  patientSchema,
  PatientUpdate,
} from "../models/patient";

const NO_DATA_MESSAGE = "No data returned from API";
const BASE_PATH = "/medical/v1";
const ORGANIZATION_URL = `/organization`;
const FACILITY_URL = `/facility`;
const PATIENT_URL = `/patient`;
const LINK_URL = `/link`;
const DOCUMENT_URL = `/document`;

export type Options = {
  axios?: AxiosStatic; // Set axios if it fails to load
  timeout?: number;
  additionalHeaders?: Record<string, string>;
} & (
  | {
      sandbox?: boolean;
      baseAddress?: never;
    }
  | {
      sandbox?: never;
      baseAddress?: string;
    }
);

export class MetriportMedicalApi {
  readonly api: AxiosInstance;

  static readonly headers = {
    clientApp: "x-metriport-client",
  };

  /**
   * Creates a new instance of the Metriport Medical API client.
   *
   * @param apiKey Your Metriport API key.
   * @param options - Optional parameters
   * @param options.additionalHeaders - HTTP headers to be used in all requests.
   * @param options.axios - Axios instance, default, useful when the dependency is not being imported
   *          properly by NPM.
   * @param options.sandbox - Indicates whether to connect to the sandbox, default false.
   * @param options.timeout - Connection timeout in milliseconds, default 20 seconds.
   */
  constructor(apiKey: string, options: Options = {}) {
    const headers = { [API_KEY_HEADER]: apiKey, ...options.additionalHeaders };
    const { sandbox, timeout } = options;

    const baseURL =
      (options.baseAddress || (sandbox ? BASE_ADDRESS_SANDBOX : BASE_ADDRESS)) + BASE_PATH;
    const axiosConfig: CreateAxiosDefaults = {
      timeout: timeout ?? DEFAULT_AXIOS_TIMEOUT_MILLIS,
      baseURL,
      headers,
    };

    if (axios) {
      this.api = axios.create(axiosConfig);
    } else if (options.axios) {
      this.api = options.axios.create(axiosConfig);
    } else {
      throw new Error(`Failed to initialize Axios`);
    }
  }

  /**
   * Creates a new organization.
   *
   * @param data The data to be used to create a new organization.
   * @returns The created organization.
   */
  async createOrganization(data: OrganizationCreate): Promise<Organization> {
    const resp = await this.api.post(ORGANIZATION_URL, data);
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return organizationSchema.parse(resp.data);
  }

  /**
   * Updates an organization.
   *
   * @param organization The organization data to be updated.
   * @return The updated organization.
   */
  async updateOrganization(organization: Organization): Promise<Organization> {
    type FieldsToOmit = "id";
    const payload: Omit<Organization, FieldsToOmit> & Record<FieldsToOmit, undefined> = {
      ...organization,
      id: undefined,
    };
    const resp = await this.api.put(`${ORGANIZATION_URL}/${organization.id}`, payload, {
      headers: { ...getETagHeader(organization) },
    });
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return organizationSchema.parse(resp.data);
  }

  /**
   * Retrieve an organization representing this account.
   *
   * @returns The organization, or undefined if no organization has been created.
   */
  async getOrganization(): Promise<Organization | undefined> {
    const resp = await this.api.get(ORGANIZATION_URL);
    if (!resp.data) return undefined;
    return organizationSchema.parse(resp.data);
  }

  /**
   * Creates a new facility.
   *
   * @param data The data to be used to create a new facility.
   * @return The newly created facility.
   */
  async createFacility(data: FacilityCreate): Promise<Facility> {
    const resp = await this.api.post(`${FACILITY_URL}`, data);
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return facilitySchema.parse(resp.data);
  }

  /**
   * Returns a facility.
   *
   * @param id The ID of the facility to be returned.
   * @return The facilities.
   */
  async getFacility(id: string): Promise<Facility> {
    const resp = await this.api.get(`${FACILITY_URL}/${id}`);
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return facilitySchema.parse(resp.data);
  }

  /**
   * Updates a facility.
   *
   * @param facility The facility data to be updated.
   * @return The updated facility.
   */
  async updateFacility(facility: Facility): Promise<Facility> {
    type FieldsToOmit = "id";
    const payload: Omit<Facility, FieldsToOmit> & Record<FieldsToOmit, undefined> = {
      ...facility,
      id: undefined,
    };
    const resp = await this.api.put(`${FACILITY_URL}/${facility.id}`, payload, {
      headers: { ...getETagHeader(facility) },
    });
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return facilitySchema.parse(resp.data);
  }

  /**
   * Returns the facilities associated with this account.
   *
   * @return The list of facilities.
   */
  async listFacilities(): Promise<Facility[]> {
    const resp = await this.api.get(`${FACILITY_URL}`);
    if (!resp.data) [];
    return facilityListSchema.parse(resp.data).facilities;
  }

  /**
   * Creates a new patient at Metriport and HIEs.
   *
   * @param data The data to be used to create a new patient.
   * @param facilityId The facility providing the NPI to support this operation.
   * @return The newly created patient.
   */
  async createPatient(data: PatientCreate, facilityId: string): Promise<Patient> {
    const resp = await this.api.post(`${PATIENT_URL}`, data, {
      params: { facilityId },
    });
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return patientSchema.parse(resp.data);
  }

  /**
   * Returns a patient.
   *
   * @param id The ID of the patient to be returned.
   * @return The patients.
   */
  async getPatient(id: string): Promise<Patient> {
    const resp = await this.api.get(`${PATIENT_URL}/${id}`);
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return patientSchema.parse(resp.data);
  }

  /**
   * Updates a patient at Metriport and at HIEs the patient is linked to.
   *
   * @param patient The patient data to be updated.
   * @param facilityId The facility providing the NPI to support this operation.
   * @return The updated patient.
   */
  async updatePatient(patient: PatientUpdate, facilityId: string): Promise<Patient> {
    type FieldsToOmit = "id";
    const payload: Omit<PatientUpdate, FieldsToOmit> & Record<FieldsToOmit, undefined> = {
      ...patient,
      id: undefined,
    };
    const resp = await this.api.put(`${PATIENT_URL}/${patient.id}`, payload, {
      params: { facilityId },
      headers: { ...getETagHeader(patient) },
    });
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return patientSchema.parse(resp.data);
  }

  /**
   * Removes a patient at Metriport and at HIEs the patient is linked to.
   *
   * @param patientId The ID of the patient data to be deleted.
   * @param facilityId The facility providing the NPI to support this operation.
   */
  async deletePatient(patientId: string, facilityId: string, eTag?: string): Promise<void> {
    await this.api.delete(`${PATIENT_URL}/${patientId}`, {
      params: { facilityId },
      headers: { ...getETagHeader({ eTag }) },
    });
  }

  /**
   * Returns the patients associated with given facility.
   *
   * @param facilityId The ID of the facility.
   * @return The list of patients.
   */
  async listPatients(facilityId: string): Promise<Patient[]> {
    const resp = await this.api.get(`${PATIENT_URL}`, {
      params: { facilityId },
    });
    if (!resp.data) [];
    return patientListSchema.parse(resp.data).patients;
  }

  /**
   * Returns the current state of a patient's links across HIEs.
   *
   * @param patientId The ID of the patient for which to retrieve links.
   * @param facilityId The facility providing the NPI to support this operation.
   * @returns The patient's current and potential links.
   */
  async listLinks(patientId: string, facilityId: string): Promise<PatientLinks> {
    const resp = await this.api.get(`${PATIENT_URL}/${patientId}${LINK_URL}`, {
      params: { facilityId },
    });
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return patientLinksSchema.parse(resp.data);
  }
  /**
   * @deprecated Use listLinks() instead.
   */
  async getLinks(patientId: string, facilityId: string): Promise<PatientLinks> {
    return this.listLinks(patientId, facilityId);
  }

  /**
   * Creates link between a patient at Metriport and an entity (person/patient) on an
   * HIE (medical data source).
   *
   * @param patientId The ID of the patient at Metriport.
   * @param facilityId The facility providing the NPI to support this operation.
   * @param entityId The ID of the entity to link to the patient.
   * @param linkSource The HIE containing the entity to be linked with.
   */
  async createLink(
    patientId: string,
    facilityId: string,
    entityId: string,
    linkSource: MedicalDataSource
  ): Promise<void> {
    await this.api.post(
      `${PATIENT_URL}/${patientId}${LINK_URL}/${linkSource}`,
      { entityId },
      { params: { facilityId } }
    );
  }

  /**
   * Removes a link between a patient at Metriport and an entity (person/patient) on
   * an HIE (medical data source).
   *
   * @param patientId The ID of the patient at Metriport.
   * @param facilityId The facility providing the NPI to support this operation.
   * @param linkSource The HIE to remove the link from.
   */
  async removeLink(
    patientId: string,
    facilityId: string,
    linkSource: MedicalDataSource
  ): Promise<void> {
    await this.api.delete(`${PATIENT_URL}/${patientId}${LINK_URL}/${linkSource}`, {
      params: { facilityId },
    });
  }

  /**
   * Returns document references for the given patient across HIEs.
   *
   * @param patientId Patient ID for which to retrieve document metadata.
   * @param facilityId The facility providing the NPI to support this operation.
   * @return The metadata of available documents.
   */
  async listDocuments(patientId: string, facilityId: string): Promise<DocumentList> {
    const resp = await this.api.get(`${DOCUMENT_URL}`, {
      params: {
        patientId,
        facilityId,
      },
    });
    if (!resp.data) [];
    return documentListSchema.parse(resp.data);
  }

  /**
   * Start a document query for the given patient across HIEs.
   *
   * @param patientId Patient ID for which to retrieve document metadata.
   * @param facilityId The facility providing the NPI to support this operation.
   * @return The document query progress & status indicating whether its being executed or not.
   */
  async startDocumentQuery(patientId: string, facilityId: string): Promise<DocumentQuery> {
    const resp = await this.api.post(`${DOCUMENT_URL}/query`, null, {
      params: {
        patientId,
        facilityId,
      },
    });
    if (!resp.data) throw new Error(NO_DATA_MESSAGE);
    return documentQuerySchema.parse(resp.data);
  }

  /**
   * Returns a URL that can be used to download the document.
   *
   * @param req.query.fileName The file name of the document in s3.
   * @param req.query.conversionType The doc type to convert to. Valid values are "html" and "pdf".
   * @return presigned url
   */
  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getDocumentUrl(
    fileName: string,
    conversionType?: "html" | "pdf"
  ): Promise<{ url: string }> {
    const resp = await this.api.get(`${DOCUMENT_URL}/downloadUrl`, {
      params: {
        fileName,
        conversionType,
      },
    });

    return resp.data;
  }
}
