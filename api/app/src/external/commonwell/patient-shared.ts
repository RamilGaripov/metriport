import {
  CommonWellAPI,
  getDemographics,
  getId,
  Patient as CommonwellPatient,
  Person as CommonwellPerson,
  RequestMetadata,
  StrongId,
} from "@metriport/commonwell-sdk";
import _, { maxBy } from "lodash";
import { getPatientWithDependencies } from "../../command/medical/patient/get-patient";
import BadRequestError from "../../errors/bad-request";
import { Facility } from "../../models/medical/facility";
import { Organization } from "../../models/medical/organization";
import { Patient, PatientExternalDataEntry } from "../../models/medical/patient";
import { filterTruthy } from "../../shared/filter-map-utils";
import { capture } from "../../shared/notifications";
import { driversLicenseURIs } from "../../shared/oid";
import { Util } from "../../shared/util";
import { makePersonForPatient } from "./patient-conversion";

export class PatientDataCommonwell extends PatientExternalDataEntry {
  constructor(public patientId: string, public personId?: string | undefined) {
    super();
  }
}

type SimplifiedPersonalId = { key: string; system: string };

type FindOrCreatePersonResponse = { personId: string; person: CommonwellPerson } | undefined;

export async function findOrCreatePerson({
  commonWell,
  queryMeta,
  commonwellPatient,
  commonwellPatientId,
}: {
  commonWell: CommonWellAPI;
  queryMeta: RequestMetadata;
  commonwellPatient: CommonwellPatient;
  commonwellPatientId: string;
}): Promise<FindOrCreatePersonResponse> {
  const { log, debug } = Util.out(`CW findOrCreatePerson - CW patientId ${commonwellPatientId}`);
  const context = `cw.findOrCreatePerson.strongIds`;
  const person = makePersonForPatient(commonwellPatient);
  const strongIds = getPersonalIdentifiers(person);
  if (strongIds.length > 0) {
    // Search by personal ID
    // TODO: we should be returning instances of CommonwellPerson here, so we return what we get from CW on this function, not
    // the result of calling `makePersonForPatient()`
    const personIds = await searchPersonIds({ commonWell, queryMeta, personalIds: strongIds });
    if (personIds.length === 1) return { personId: personIds[0] as string, person };
    if (personIds.length > 1) {
      const subject = "Found more than one person for patient personal IDs";
      const message = idsToAlertMessage(commonwellPatientId, personIds);
      log(`${subject}: ${message}`);
      capture.message(subject, {
        extra: { commonwellPatientId, personIds, context },
      });
      // TODO consider also returning the most recent person here
      return undefined;
    }
  } else {
    // Search by demographics
    const respSearch = await commonWell.searchPersonByPatientDemo(queryMeta, commonwellPatientId);
    debug(`resp searchPersonByPatientDemo: ${JSON.stringify(respSearch, null, 2)}`);
    const persons = respSearch._embedded?.person
      ? respSearch._embedded.person.flatMap(p => (p && getId(p) ? p : []))
      : [];
    if (persons.length > 1) {
      return alertAndReturnMostRecentPerson(
        commonwellPatientId,
        [persons[0] as CommonwellPerson, ...persons.slice(1)], // to match the type requiring at least one element
        commonWell.lastReferenceHeader,
        context
      );
    }
    const cwPerson = persons.flatMap(filterTruthy)[0];
    const personId = getId(cwPerson);
    if (cwPerson && personId) return { personId, person: cwPerson };
    // if didn't find any, proceed to enroll
  }

  // If not found, enroll/add person
  debug(`Enrolling this person: ${JSON.stringify(person, null, 2)}`);
  const respPerson = await commonWell.enrollPerson(queryMeta, person);
  debug(`resp enrollPerson: ${JSON.stringify(respPerson, null, 2)}`);
  const personId = getId(respPerson);
  if (!personId) {
    const msg = `Could not get person ID from CW response`;
    log(`${msg} - CW response: ${JSON.stringify(respPerson)}`);
    throw new Error(msg);
  }
  return { personId, person };
}

function alertAndReturnMostRecentPerson(
  commonwellPatientId: string,
  persons: [CommonwellPerson, ...CommonwellPerson[]],
  cwReference?: string,
  context?: string
): FindOrCreatePersonResponse {
  const { log } = Util.out(
    `CW alertAndReturnMostRecentPerson - CW patientId ${commonwellPatientId}`
  );
  const personIds = persons.map(getId).flatMap(filterTruthy);
  const subject = "Found more than one person for patient demographics";
  const message = idsToAlertMessage(commonwellPatientId, personIds);
  log(`${subject} - using the most recent one: ${message}`);
  capture.message(subject, {
    extra: {
      action: `Using the most recent one`,
      commonwellPatientId,
      persons: getDemographics(persons),
      cwReference,
      context,
    },
  });
  const person = getMostRecentPerson(persons);
  const personId = getId(person);
  if (person && personId) return { personId, person };
  return undefined;
}

function getMostRecentPerson(persons: [CommonwellPerson, ...CommonwellPerson[]]): CommonwellPerson {
  const mostRecent = maxBy(persons, p => p.enrollmentSummary?.dateEnrolled);
  const lastOne = persons[persons.length - 1]; // .at(-1) doesn't expose the correct type
  return (mostRecent ?? lastOne) as CommonwellPerson;
}

function idsToAlertMessage(cwPatientId: string, personIds: string[]): string {
  return `Patient CW ID: ${cwPatientId}; Person IDs: ${personIds.join(", ")}`;
}

export async function getPatientData(
  patient: {
    id: string;
    cxId: string;
  },
  facilityId: string
): Promise<{
  organization: Organization;
  facility: Facility;
}> {
  const { organization, facilities } = await getPatientWithDependencies(patient);
  const facility = facilities.find(f => f.id === facilityId);
  if (!facility) {
    throw new BadRequestError(`Patient not associated with given facility`);
  }
  return { organization, facility };
}

export function getMatchingStrongIds(
  person: CommonwellPerson,
  commonwellPatient: CommonwellPatient
): StrongId[] {
  const personIds = person.details?.identifier;
  const patientIds = commonwellPatient.details?.identifier;
  if (!personIds || !personIds.length || !patientIds || !patientIds.length) return [];
  return _.intersectionBy(personIds, patientIds, id => `${id.system}|${id.key}`);
}

export async function searchPersonIds({
  commonWell,
  queryMeta,
  personalIds,
}: {
  commonWell: CommonWellAPI;
  queryMeta: RequestMetadata;
  personalIds: SimplifiedPersonalId[];
}): Promise<string[]> {
  const { log } = Util.out(`CW searchPersonIds`);
  const respSearches = await Promise.allSettled(
    personalIds.map(id =>
      commonWell.searchPerson(queryMeta, id.key, id.system).catch(err => {
        log(`Failure searching person @ CW by personal ID`, err);
        capture.error(err, { extra: { context: `cw.searchPersonIds` } });
        throw err;
      })
    )
  );
  const fulfilledPersons = respSearches
    .flatMap(r => (r.status === "fulfilled" ? r.value._embedded?.person : []))
    .flatMap(filterTruthy);
  const duplicatedPersonIds = fulfilledPersons.flatMap(getId).flatMap(filterTruthy);
  return Array.from(new Set(duplicatedPersonIds));
}

export function getPersonalIdentifiers(
  person: CommonwellPatient | CommonwellPerson
): SimplifiedPersonalId[] {
  return (person.details?.identifier ?? []).flatMap(id =>
    id.key !== undefined && id.system !== undefined ? { key: id.key, system: id.system } : []
  );
}

export async function searchPersons({
  commonWell,
  queryMeta,
  strongIds,
}: {
  commonWell: CommonWellAPI;
  queryMeta: RequestMetadata;
  strongIds: SimplifiedPersonalId[];
}): Promise<CommonwellPerson[]> {
  const respSearches = await Promise.allSettled(
    strongIds.map(id =>
      commonWell.searchPerson(queryMeta, id.key, id.system).catch(err => {
        console.log(`Failed to search for person with strongId: `, err);
        capture.error(err, { extra: { context: `cw.searchPersons` } });
        throw err;
      })
    )
  );
  const fulfilled = respSearches
    .flatMap(r => (r.status === "fulfilled" ? r.value._embedded?.person : []))
    .flatMap(filterTruthy);

  return fulfilled;
}

export function getPersonalIdentifiersFromPatient(patient: Patient): SimplifiedPersonalId[] {
  return (patient.data.personalIdentifiers ?? []).flatMap(id =>
    id.value !== undefined && id.state !== undefined
      ? { key: id.value, system: driversLicenseURIs[id.state] }
      : []
  );
}
