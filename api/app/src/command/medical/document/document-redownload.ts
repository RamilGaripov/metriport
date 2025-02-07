import {
  Coding,
  DocumentReference,
  DocumentReferenceContent,
  Identifier,
  Resource,
} from "@medplum/fhirtypes";
import {
  Contained,
  Document,
  DocumentContent,
  DocumentIdentifier,
} from "@metriport/commonwell-sdk";
import { difference, differenceBy, groupBy } from "lodash";
import { DeepRequired } from "ts-essentials";
import { downloadDocsAndUpsertFHIR } from "../../../external/commonwell/document/document-query";
import { hasCommonwellContent, isCommonwellContent } from "../../../external/commonwell/extension";
import { makeFhirApi } from "../../../external/fhir/api/api-factory";
import { downloadedFromHIEs } from "../../../external/fhir/shared";
import { isMetriportContent } from "../../../external/fhir/shared/extensions/extension";
import { decodeExternalId } from "../../../shared/external";
import { capture } from "../../../shared/notifications";
import { Util } from "../../../shared/util";
import { getOrganizationOrFail } from "../organization/get-organization";
import { getPatientOrFail } from "../patient/get-patient";
import { updateDocQuery } from "./document-query";

export const reprocessDocuments = async ({
  cxId,
  documentIds,
  override = false,
}: {
  cxId: string;
  documentIds: string[];
  override?: boolean;
}): Promise<void> => {
  const { log } = Util.out(`reprocessDocuments - cxId ${cxId}`);
  documentIds.length
    ? log(`Re-processing documents (${documentIds.length}): ${documentIds.join(", ")}`)
    : log(`Re-processing all documents`);

  // Get documents from FHIR
  const fhir = makeFhirApi(cxId);
  const documentsFromFHIR = await fhir.searchResources("DocumentReference", {
    _id: documentIds.join(","),
  });
  // Only use re-download docs we got from CommonWell
  const documentsFromHIEs = documentsFromFHIR.filter(downloadedFromHIEs);
  // We can't override existing docs if we don't have CW's url for the Binary/attachment
  const documentsFound = override
    ? documentsFromHIEs.filter(hasCommonwellContent)
    : documentsFromHIEs;
  const documents = documentIds.length
    ? documentsFound.filter(d => d.id && documentIds.includes(d.id))
    : documentsFound;
  log(`Found ${documents.length} documents`);

  // Filter out those with enough data
  const documentsWithPatientId = documents.filter(d =>
    d.contained?.some(c => c.resourceType === "Patient")
  );
  const docsNotEnoughData = differenceBy(documents, documentsWithPatientId, "id");
  if (docsNotEnoughData.length > 0) {
    log(`...of which, ${docsNotEnoughData.length} don't have enough data and are being skipped`);
  } else {
    log(`...and all have enough data! :goodnews:`);
  }
  if (documentsWithPatientId.length === 0) {
    log(`No documents to process, exiting...`);
    return;
  }

  // Re-download the documents, update them to S3, and re-convert them to FHIR if CCDA
  await downloadDocsAndUpsertFHIRWithDocRefs({ cxId, documents: documentsWithPatientId, override });

  log(`Done.`);
};

export async function downloadDocsAndUpsertFHIRWithDocRefs({
  cxId,
  documents,
  override,
}: {
  cxId: string;
  documents: DocumentReference[];
  override: boolean;
}): Promise<void> {
  // Group docs by Patient
  const docsByPatientId = groupBy(
    documents,
    d =>
      d.contained
        ?.filter(c => c.resourceType === "Patient")
        .map(c => c.id)
        .flatMap(id => id ?? []) ?? []
  );
  for (const [patientId, docs] of Object.entries(docsByPatientId)) {
    await processDocsOfPatient({ cxId, patientId, docs, override });
  }
}

async function processDocsOfPatient({
  cxId,
  patientId,
  docs,
  override,
}: {
  cxId: string;
  patientId: string;
  docs: DocumentReference[];
  override: boolean;
}): Promise<void> {
  const { log } = Util.out(`processDocsOfPatient - M patientId ${patientId}`);

  const patient = await getPatientOrFail({ id: patientId, cxId });
  if (patient.data.documentQueryStatus === "processing") {
    log(`Patient ${patientId} is already being processed, skipping ${docs.length} docs...`);
    return;
  }
  const organization = await getOrganizationOrFail({ cxId });

  const docsAsCW: Document[] = convertDocRefToCW(docs, override);
  if (docsAsCW.length !== docs.length) {
    const idsDocs = docs.map(d => d.id);
    const idsDocsCW = docsAsCW.map(d => d.id);
    const diff = difference(idsDocs, idsDocsCW);
    log(
      `Got ${docs.length} documents but only converted ${docsAsCW.length} to post to FHIR - missing: `,
      diff
    );
  }
  if (docsAsCW.length === 0) return;

  const facilityId = patient.facilityIds[0];
  if (!facilityId) throw new Error(`Patient ${patientId} is missing facilityId`);

  try {
    log(`Processing ${docs.length} documents for patient ${patientId}...`);
    await updateDocQuery({ patient: { id: patientId, cxId }, status: "processing" });

    await downloadDocsAndUpsertFHIR({
      patient,
      organization,
      facilityId,
      documents: docsAsCW,
      override,
    });
  } catch (error) {
    log(`Error processing docs: `, error);
    capture.error(error, { extra: { context: `processDocsOfPatient`, error } });
  } finally {
    await updateDocQuery({ patient: { id: patientId, cxId }, status: "completed" });
  }
  log(`Done for patient ${patientId}`);
}

function convertDocRefToCW(docs: DocumentReference[], isOverride: boolean): Document[] {
  return docs.flatMap(d => {
    const emptyMsg = (property: string) => {
      console.log(`Document ${d.id} is missing ${property}, skipping...`);
      return [];
    };
    if (!d.id) return emptyMsg("id");
    if (!d.content) return emptyMsg("content");
    if (!d.content.length) return emptyMsg("content.length");
    let content: DocumentReferenceContent | undefined = {};
    if (isOverride) {
      // if we want to override we need the CW url
      const cwContent = d.content.filter(isCommonwellContent);
      content = cwContent[0];
      if (!content) return emptyMsg("cwContent");
    } else {
      const metriportContent = d.content.filter(isMetriportContent);
      content = metriportContent[0];
      if (!content) return emptyMsg("cwContent");
    }
    if (!d.type) return emptyMsg("type");
    if (!d.status) return emptyMsg("status");
    if (!d.masterIdentifier) return emptyMsg("masterIdentifier");
    const masterIdValue = d.masterIdentifier.value;
    if (!masterIdValue) return emptyMsg("masterIdentifier.value");
    if (!d.subject) return emptyMsg("subject");
    const subjectReference = d.subject.reference;
    if (!subjectReference) return emptyMsg("subject.reference");
    if (!d.context) return emptyMsg("context");
    try {
      const cwDoc: Document = {
        /**
         * HEADS UP: This is important! We assume the doc refs we get from the FHIR
         * server were inserted with their IDs encoded.
         */
        id: decodeExternalId(d.id),
        content: {
          resourceType: "DocumentReference",
          ...(d.contained && {
            contained: d.contained.map(fhirContainedToCW).flatMap(c => c ?? []),
          }),
          ...(d.masterIdentifier && {
            masterIdentifier: {
              ...d.masterIdentifier,
              value: masterIdValue,
            },
          }),
          ...(d.identifier && { identifier: d.identifier.map(fhirIdentifierToCW) }),
          subject: {
            ...d.subject,
            reference: subjectReference,
          },
          ...(d.type && { type: d.type }),
          ...(d.category && { category: d.category }),
          ...(d.author && {
            author: d.author.flatMap(a => (a.reference ? { reference: a.reference } : [])),
          }),
          indexed: d.date ?? d.meta?.lastUpdated ?? new Date().toISOString(),
          status: fhirStatusToCW(d.status),
          description: d.description,
          mimeType: content.attachment?.contentType,
          size: content.attachment?.size,
          hash: content.attachment?.hash,
          location: content.attachment?.url,
          ...(content.format && { format: fhirFormatToCW(content.format) }),
          context: d.context,
          type: {
            coding: d.type.coding,
            text: d.type.text,
          },
        },
      };
      return cwDoc;
    } catch (error) {
      console.log(`[convertDocRefToCW] Error converting docRef ${d.id} to CW: `, error);
      capture.error(error, {
        extra: {
          context: `convertDocRefToCW`,
          document: d,
          error,
        },
      });
      return [];
    }
  });
}

export const fhirContainedToCW = (contained: Resource): Contained | undefined => {
  const base = {
    id: contained.id,
  };
  switch (contained.resourceType) {
    case "Patient":
      return {
        ...base,
        identifier: contained.identifier?.map(fhirIdentifierToCW),
      };
    case "Organization":
      return {
        ...base,
        identifier: contained.identifier?.map(fhirIdentifierToCW),
        name: contained.name,
      };
    default:
      return undefined;
  }
};

export const fhirIdentifierToCW = (id: Identifier): DocumentIdentifier => {
  if (!id.value) throw new Error(`Missing identifier.value`);
  return {
    use: id.use,
    system: id.system,
    value: id.value,
  };
};

export const fhirStatusToCW = (
  status: DeepRequired<DocumentReference>["status"]
): Document["content"]["status"] => {
  return status === "superseded"
    ? "superceded"
    : status === "entered-in-error"
    ? "entered in error"
    : status;
};

export const fhirFormatToCW = (format: Coding): DocumentContent["format"] => {
  return format.system || format.code || format.display;
};
