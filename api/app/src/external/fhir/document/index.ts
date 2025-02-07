import { DocumentReference, DocumentReferenceContent, Identifier } from "@medplum/fhirtypes";
import { DocumentIdentifier } from "@metriport/commonwell-sdk";
import { MedicalDataSourceOid } from "../..";
import { Organization } from "../../../models/medical/organization";
import { Patient } from "../../../models/medical/patient";
import { CWDocumentWithMetriportData } from "../../commonwell/document/shared";
import { cwExtension } from "../../commonwell/extension";
import { ResourceType } from "../shared";
import { metriportDataSourceExtension } from "../shared/extensions/extension";
import dayjs from "dayjs";
import isToday from "dayjs/plugin/isToday";
dayjs.extend(isToday);

export const MAX_FHIR_DOC_ID_LENGTH = 64;

// HIEs probably don't have records before the year 1800 :)
const earliestPossibleYear = 1800;

function getBestDateFromCWDocRef(doc: CWDocumentWithMetriportData): string {
  const date = dayjs(doc.content?.indexed);

  // if the timestamp from CW for the indexed date is from today, this usually
  // means that the timestamp is auto-generated, and there may be a more accurate
  // timestamp in the doc ref.
  if (date.isToday() && doc.content?.context?.period?.start) {
    const newDate = dayjs(doc.content.context.period.start);

    // this check is necessary to prevent using weird dates... seen stuff like
    // this before:  "period": { "start": "0001-01-01T00:00:00Z" }
    if (newDate.year() >= earliestPossibleYear) {
      return newDate.toISOString();
    }
  }

  return date.toISOString();
}

export const toFHIR = (
  docId: string,
  doc: CWDocumentWithMetriportData,
  organization: Organization,
  patient: Patient
): DocumentReference => {
  const baseAttachment = {
    contentType: doc.content?.mimeType,
    size: doc.metriport.fileSize != null ? doc.metriport.fileSize : doc.content?.size, // can't trust the file size from CW, use what we actually saved
    creation: doc.content?.indexed,
  };
  const metriportContent: DocumentReferenceContent = {
    attachment: {
      ...baseAttachment,
      title: doc.metriport.fileName,
      url: doc.metriport.location,
    },
    extension: [metriportDataSourceExtension],
  };
  const cwContent = doc.content?.location
    ? [
        {
          attachment: {
            ...baseAttachment,
            title: doc.metriport.fileName, // no filename on CW doc refs
            url: doc.content.location,
          },
          extension: [cwExtension],
        },
      ]
    : [];
  return {
    id: docId,
    resourceType: ResourceType.DocumentReference,
    contained: [
      {
        resourceType: ResourceType.Organization,
        id: organization.id,
        name: organization.data.name,
      },
      {
        resourceType: ResourceType.Patient,
        id: patient.id,
      },
    ],
    masterIdentifier: {
      system: doc.content?.masterIdentifier?.system,
      value: doc.content?.masterIdentifier?.value,
    },
    identifier: doc.content?.identifier?.map(idToFHIR),
    date: getBestDateFromCWDocRef(doc),
    status: "current",
    type: doc.content?.type,
    subject: {
      reference: `Patient/${patient.id}`,
      type: ResourceType.Patient,
    },
    author: [
      {
        reference: `#${organization.id}`,
        type: ResourceType.Organization,
      },
    ],
    // DEFAULT TO COMMONWELL FOR NOW
    custodian: {
      id: MedicalDataSourceOid.COMMONWELL,
    },
    description: doc.content?.description,
    content: [...cwContent, metriportContent],
    extension: [cwExtension],
    context: doc.content?.context,
  };
};

// TODO once we merge DocumentIdentifier with Identifier on CW SDK, let's move this to
// an identifier-specific file
export function idToFHIR(id: DocumentIdentifier): Identifier {
  return {
    system: id.system,
    value: id.value,
    use: id.use === "unspecified" ? undefined : id.use,
  };
}
