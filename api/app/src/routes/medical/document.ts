import { Request, Response } from "express";
import Router from "express-promise-router";
import { OK } from "http-status";
import { downloadDocument } from "../../command/medical/document/document-download";
import {
  createQueryResponse,
  queryDocumentsAcrossHIEs,
} from "../../command/medical/document/document-query";
import { getPatientOrFail } from "../../command/medical/patient/get-patient";
import ForbiddenError from "../../errors/forbidden";
import { getDocuments } from "../../external/fhir/document/get-documents";
import { Config } from "../../shared/config";
import { stringToBoolean } from "../../shared/types";
import { asyncHandler, getCxIdOrFail, getFrom, getFromQueryOrFail } from "../util";
import { toDTO } from "./dtos/documentDTO";
import { parseISODate } from "../../shared/date";
import { docConversionTypeSchema } from "./schemas/documents";
import dayjs from "dayjs";

const router = Router();

/** ---------------------------------------------------------------------------
 * GET /document
 *
 * Lists all Documents that can be retrieved for a Patient.
 *
 *
 * It also returns the status of querying document references across HIEs,
 * indicating whether there is an asynchronous query in progress (status processing)
 * or not (status completed).
 *
 * If the query is in progress, you will also receive the total number of documents
 * to be queried as well as the ones that have already been completed.
 *
 * @param req.query.patientId Patient ID for which to list documents.
 * @param req.query.dateFrom Optional start date that docs will be filtered by (inclusive).
 * @param req.query.dateTo Optional end date that docs will be filtered by (inclusive).
 * @return The available documents, including query status and progress - as applicable.
 */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const cxId = getCxIdOrFail(req);
    const patientId = getFromQueryOrFail("patientId", req);
    const dateFrom = parseISODate(getFrom("query").optional("dateFrom", req));
    const dateTo = parseISODate(getFrom("query").optional("dateTo", req));

    const documents = await getDocuments({ cxId, patientId });
    const documentsDTO = toDTO(documents).flatMap(doc => {
      if (!doc.indexed) return doc;
      if (
        (!dateFrom || dayjs(dateFrom).isBefore(doc.indexed)) &&
        (!dateTo || dayjs(dateTo).isAfter(doc.indexed))
      ) {
        return doc;
      }
      return [];
    });

    const patient = await getPatientOrFail({ cxId, id: patientId });

    const queryResp = createQueryResponse(patient.data.documentQueryStatus ?? "completed", patient);

    return res.status(OK).json({
      ...queryResp,
      documents: documentsDTO,
    });
  })
);

/** ---------------------------------------------------------------------------
 * GET /document/query
 *
 * Triggers a document query for the specified patient across HIEs.
 *
 * @param req.query.patientId Patient ID for which to retrieve document metadata.
 * @param req.query.facilityId The facility providing NPI for the document query.
 * @param req.query.override Whether to override files already downloaded (optional, defaults to false).
 * @return The status of document querying.
 */
router.post(
  "/query",
  asyncHandler(async (req: Request, res: Response) => {
    const cxId = getCxIdOrFail(req);
    const patientId = getFromQueryOrFail("patientId", req);
    const facilityId = getFromQueryOrFail("facilityId", req);
    const override = stringToBoolean(getFrom("query").optional("override", req));

    const { queryStatus, queryProgress } = await queryDocumentsAcrossHIEs({
      cxId,
      patientId,
      facilityId,
      override,
    });

    return res.status(OK).json({ queryStatus, queryProgress });
  })
);

/** ---------------------------------------------------------------------------
 * GET /downloadUrl
 *
 * Fetches the document from S3 and sends a presigned URL
 *
 * @param req.query.fileName The file name of the document in s3.
 * @param req.query.conversionType The doc type to convert to.
 * @return presigned url
 */
router.get(
  "/downloadUrl",
  asyncHandler(async (req: Request, res: Response) => {
    const cxId = getCxIdOrFail(req);
    const fileName = getFromQueryOrFail("fileName", req);
    const fileHasCxId = fileName.includes(cxId);
    const type = getFrom("query").optional("conversionType", req);
    const conversionType = type ? docConversionTypeSchema.parse(type) : undefined;

    if (!fileHasCxId && !Config.isSandbox()) throw new ForbiddenError();

    const url = await downloadDocument({ fileName, conversionType });

    return res.status(OK).json({ url });
  })
);

export default router;
