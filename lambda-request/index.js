const { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb")
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns")
const crypto = require("crypto")

const dynamoClient = new DynamoDBClient({})
const snsClient = new SNSClient({})

const TABLE_NAME = process.env.TABLE_NAME
const AGENCY_RESPONSE_TABLE = process.env.AGENCY_RESPONSE_TABLE
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE
const TOPIC_ARN = process.env.TOPIC_ARN

const RESCUE_SERVICE_BASE_URL = process.env.RESCUE_SERVICE_BASE_URL

// --- Custom Error Classes ---

class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = "ValidationError"
    this.statusCode = 400
    this.code = "VALIDATION_ERROR"
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = "NotFoundError"
    this.statusCode = 404
    this.code = "NOT_FOUND"
  }
}

class RescueServiceError extends Error {
  constructor(message, statusCode, rescueErrorBody) {
    super(message)
    this.name = "RescueServiceError"
    this.statusCode = statusCode
    this.rescueErrorBody = rescueErrorBody || null
  }
}

// --- Handler ---

exports.handler = async (event, context) => {

  const traceId = context.awsRequestId

  console.log("[HANDLER] Incoming event:", JSON.stringify(event))
  console.log("[HANDLER] TraceId:", traceId)

  const method = event.requestContext?.http?.method
  const path = event.rawPath

  try {

    if (method === "OPTIONS") {
      return createResponse(200, {}, traceId)
    }

    if (method === "GET" && path === "/v1/incidents") {
      return await getIncidents(event, traceId)
    }

    if (method === "POST" && path === "/v1/damage-reports") {
      return await createDamageReport(event, traceId)
    }

    if (method === "GET" && path === "/v1/damage-reports") {
      return await getAllReports(event, traceId)
    }

    if (method === "GET" && path.startsWith("/v1/damage-reports/")) {
      return await getReportById(event, traceId)
    }

    if (method === "POST" && path === "/v1/agency-responses") {
      return await agencyResponse(event, traceId)
    }

    throw new NotFoundError("Route not found")

  } catch (error) {

    console.error("[HANDLER] Unhandled error:", error, "TraceId:", traceId)

    const statusCode = error.statusCode || 500
    const code = error.code || "INTERNAL_ERROR"

    return createResponse(statusCode, {
      error: {
        code: code,
        message: error.message,
        traceId: traceId
      }
    }, traceId)
  }
}

// --- Route Handlers ---

async function getIncidents(event, traceId) {

  console.log("[GET /v1/incidents] Fetching all incidents, TraceId:", traceId)

  const result = await dynamoClient.send(new ScanCommand({
    TableName: INCIDENTS_TABLE
  }))

  const items = (result.Items || []).map(item => ({
    incidentId: item.incidentId.S,
    incidentType: item.incidentType.S,
    incidentDescription: item.incidentDescription.S,
    location: item.location.S,
    status: item.status.S,
    priority: item.priority.S
  }))

  console.log("[GET /v1/incidents] Found:", items.length, "items, TraceId:", traceId)

  return createResponse(200, { items }, traceId)
}

async function createDamageReport(event, traceId) {

  console.log("[POST /v1/damage-reports] Start, TraceId:", traceId)

  const body = JSON.parse(event.body || "{}")

  console.log("[POST /v1/damage-reports] Body:", JSON.stringify(body), "TraceId:", traceId)

  validateInput(body)

  const reportId = "REP-" + Date.now()
  const createdAt = new Date().toISOString()

  console.log("[POST /v1/damage-reports] Generated reportId:", reportId, "TraceId:", traceId)

  // Step 1 — Save damage report
  console.log("[POST /v1/damage-reports] Step 1: Saving damage report to DynamoDB, TraceId:", traceId)
  await saveDamageReport(body, reportId, createdAt)
  console.log("[POST /v1/damage-reports] Step 1: Done, TraceId:", traceId)

  // Step 2 — Publish to SNS (always, independent of rescueRequest)
  console.log("[POST /v1/damage-reports] Step 2: Publishing to SNS, TraceId:", traceId)
  await publishEventToSNS(body, reportId, createdAt, traceId)
  console.log("[POST /v1/damage-reports] Step 2: Done, TraceId:", traceId)

  // Step 3 — Update status to forwarded
  console.log("[POST /v1/damage-reports] Step 3: Updating report status to forwarded, TraceId:", traceId)
  await updateReportStatus(reportId)
  console.log("[POST /v1/damage-reports] Step 3: Done, TraceId:", traceId)

  // Step 4 — Optional: Forward rescue request (separate, does not affect SNS flow)
  let rescueResult = null

  if (body.rescueRequest && typeof body.rescueRequest === "object") {

    console.log("[POST /v1/damage-reports] Step 4: rescueRequest detected, validating, TraceId:", traceId)

    validateRescueRequest(body.rescueRequest)

    console.log("[POST /v1/damage-reports] Step 4: Forwarding to rescue service, TraceId:", traceId)

    try {

      rescueResult = await forwardRescueRequest({
        rescueRequest: body.rescueRequest,
        incidentId: body.incidentId,
        reportId,
        traceId
      })

      console.log("[POST /v1/damage-reports] Step 4: Rescue service success:", JSON.stringify(rescueResult), "TraceId:", traceId)

      await updateReportWithRescueInfo(reportId, rescueResult)

      console.log("[POST /v1/damage-reports] Step 4: Rescue info saved to DynamoDB, TraceId:", traceId)

    } catch (rescueError) {

      console.error("[POST /v1/damage-reports] Step 4: Rescue service failed:", {
        message: rescueError.message,
        statusCode: rescueError.statusCode,
        rescueErrorBody: rescueError.rescueErrorBody || null,
        traceId
      })

      rescueResult = {
        error: true,
        message: rescueError.message,
        detail: rescueError.rescueErrorBody || null
      }
    }

  } else {
    console.log("[POST /v1/damage-reports] Step 4: No rescueRequest, skipping, TraceId:", traceId)
  }

  // Build response
  const responseBody = {
    reportId: reportId,
    overallStatus: "forwarded",
    createdAt: createdAt
  }

  if (rescueResult) {
    if (rescueResult.error) {
      responseBody.rescueRequest = {
        forwarded: false,
        error: rescueResult.message,
        detail: rescueResult.detail
      }
    } else {
      responseBody.rescueRequest = {
        forwarded: true,
        requestId: rescueResult.requestId,
        trackingCode: rescueResult.trackingCode,
        status: rescueResult.status,
        submittedAt: rescueResult.submittedAt
      }
    }
  }

  console.log("[POST /v1/damage-reports] Done. Response:", JSON.stringify(responseBody), "TraceId:", traceId)

  return createResponse(201, responseBody, traceId)
}

async function getAllReports(event, traceId) {

  console.log("[GET /v1/damage-reports] Start, TraceId:", traceId)

  const status = event.queryStringParameters?.status
  const contactPhone = event.queryStringParameters?.contactPhone

  console.log("[GET /v1/damage-reports] Filters — status:", status, "contactPhone:", contactPhone, "TraceId:", traceId)

  const result = await dynamoClient.send(new ScanCommand({ TableName: TABLE_NAME }))

  const items = result.Items || []

  const reports = items.map(item => ({
    reportId: item.reportId.S,
    incidentId: item.incidentId.S,
    damageType: item.damageType.S,
    description: item.description.S,
    location: item.location.S,
    contactPhone: item.contactPhone.S,
    overallStatus: item.overallStatus.S,
    assignedAgency: item.assignedAgency?.S || null,
    createdAt: item.createdAt.S
  }))

  let filtered = reports
  if (status) filtered = filtered.filter(r => r.overallStatus === status)
  if (contactPhone) filtered = filtered.filter(r => r.contactPhone === contactPhone)

  console.log("[GET /v1/damage-reports] Total:", reports.length, "After filter:", filtered.length, "TraceId:", traceId)

  return createResponse(200, { items: filtered }, traceId)
}

async function getReportById(event, traceId) {

  const reportId = event.pathParameters?.reportId

  console.log("[GET /v1/damage-reports/:id] reportId:", reportId, "TraceId:", traceId)

  const result = await dynamoClient.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: { reportId: { S: reportId } }
  }))

  if (!result.Item) {
    console.warn("[GET /v1/damage-reports/:id] Not found:", reportId, "TraceId:", traceId)
    throw new NotFoundError("Report not found")
  }

  const item = result.Item

  const responseBody = {
    reportId: item.reportId.S,
    incidentId: item.incidentId.S,
    damageType: item.damageType.S,
    ownershipType: item.ownershipType.S,
    description: item.description.S,
    location: item.location.S,
    reporterName: item.reporterName.S,
    contactPhone: item.contactPhone.S,
    evidenceUrl: item.evidenceUrl.S,
    overallStatus: item.overallStatus.S,
    assignedAgency: item.assignedAgency?.S || null,
    createdAt: item.createdAt.S
  }

  if (item.rescueRequestId?.S) {
    responseBody.rescueRequest = {
      forwarded: true,
      requestId: item.rescueRequestId.S,
      trackingCode: item.rescueTrackingCode?.S || null,
      status: item.rescueStatus?.S || null,
      submittedAt: item.rescueSubmittedAt?.S || null
    }
  }

  console.log("[GET /v1/damage-reports/:id] Found:", reportId, "TraceId:", traceId)

  return createResponse(200, responseBody, traceId)
}

async function agencyResponse(event, traceId) {

  console.log("[POST /v1/agency-responses] Start, TraceId:", traceId)

  const body = JSON.parse(event.body || "{}")

  console.log("[POST /v1/agency-responses] Body:", JSON.stringify(body), "TraceId:", traceId)

  const { reportId, agencyName, status, rejectReasonCode } = body

  if (!reportId || !agencyName || !status) {
    throw new ValidationError("missing required field")
  }

  if (!["accepted", "rejected"].includes(status)) {
    throw new ValidationError("invalid status")
  }

  const responseId = "RESP-" + Date.now()
  const now = new Date().toISOString()

  await saveAgencyResponse({ responseId, reportId, agencyName, status, rejectReasonCode, now })

  if (status === "accepted") {
    console.log("[POST /v1/agency-responses] Updating report as handled by:", agencyName, "TraceId:", traceId)
    await updateReportHandled(reportId, agencyName)
  }

  console.log("[POST /v1/agency-responses] Done. responseId:", responseId, "TraceId:", traceId)

  return createResponse(200, {
    message: "Agency response recorded",
    responseId: responseId,
    reportId: reportId,
    status: status
  }, traceId)
}

// --- Rescue Request Helpers ---

function validateRescueRequest(rescue) {

  const required = ["incidentId", "requestType", "description", "latitude", "longitude", "contactName", "contactPhone"]

  for (const field of required) {
    if (rescue[field] === undefined || rescue[field] === null || rescue[field] === "") {
      throw new ValidationError(`rescueRequest missing required field: ${field}`)
    }
  }

  if (typeof rescue.latitude !== "number" || rescue.latitude < -90 || rescue.latitude > 90) {
    throw new ValidationError("rescueRequest.latitude must be a number between -90 and 90")
  }

  if (typeof rescue.longitude !== "number" || rescue.longitude < -180 || rescue.longitude > 180) {
    throw new ValidationError("rescueRequest.longitude must be a number between -180 and 180")
  }
}

async function forwardRescueRequest({ rescueRequest, incidentId, reportId, traceId }) {

  const payload = {
    incidentId: rescueRequest.incidentId || incidentId,
    requestType: rescueRequest.requestType,
    description: rescueRequest.description,
    peopleCount: 1,
    latitude: rescueRequest.latitude,
    longitude: rescueRequest.longitude,
    contactName: rescueRequest.contactName,
    contactPhone: rescueRequest.contactPhone,
    sourceChannel: "OTHER",
    specialNeeds: "",
    locationDetails: rescueRequest.locationDetails || null,
    province: rescueRequest.province || null,
    district: rescueRequest.district || null,
    subdistrict: rescueRequest.subdistrict || null,
    addressLine: rescueRequest.addressLine || null
  }

  console.log("[forwardRescueRequest] Payload:", JSON.stringify(payload), "TraceId:", traceId)

  const response = await fetch(`${RESCUE_SERVICE_BASE_URL}/rescue-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Trace-Id": traceId
    },
    body: JSON.stringify(payload)
  })

  const responseBody = await response.json()

  console.log("[forwardRescueRequest] Response status:", response.status, "Body:", JSON.stringify(responseBody), "TraceId:", traceId)

  if (!response.ok) {
    console.error("[forwardRescueRequest] Error from rescue service — status:", response.status, "body:", JSON.stringify(responseBody), "TraceId:", traceId)
    throw new RescueServiceError(
      `Rescue service returned ${response.status}`,
      response.status,
      responseBody?.error || responseBody || null
    )
  }

  return {
    requestId: responseBody.requestId,
    trackingCode: responseBody.trackingCode,
    status: responseBody.status,
    submittedAt: responseBody.submittedAt
  }
}

async function updateReportWithRescueInfo(reportId, rescueResult) {

  console.log("[updateReportWithRescueInfo] reportId:", reportId, "rescueResult:", JSON.stringify(rescueResult))

  const params = {
    TableName: TABLE_NAME,
    Key: { reportId: { S: reportId } },
    UpdateExpression: "SET rescueRequestId = :reqId, rescueTrackingCode = :tc, rescueStatus = :rs, rescueSubmittedAt = :rsa, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":reqId": { S: rescueResult.requestId || "" },
      ":tc": { S: rescueResult.trackingCode || "" },
      ":rs": { S: rescueResult.status || "" },
      ":rsa": { S: rescueResult.submittedAt || "" },
      ":updatedAt": { S: new Date().toISOString() }
    }
  }

  await dynamoClient.send(new UpdateItemCommand(params))
}

// --- DynamoDB / SNS Helpers ---

async function saveDamageReport(body, reportId, createdAt) {

  const params = {
    TableName: TABLE_NAME,
    Item: {
      reportId: { S: reportId },
      incidentId: { S: body.incidentId },
      damageType: { S: body.damageType },
      ownershipType: { S: body.ownershipType },
      description: { S: body.description },
      location: { S: body.location },
      reporterName: { S: body.reporterName },
      contactPhone: { S: body.contactPhone },
      evidenceUrl: { S: body.evidenceUrl || "" },
      assignedAgency: { S: "none" },
      overallStatus: { S: "new" },
      createdAt: { S: createdAt },
      updatedAt: { S: createdAt }
    }
  }

  await dynamoClient.send(new PutItemCommand(params))
}

async function saveAgencyResponse(data) {

  const params = {
    TableName: AGENCY_RESPONSE_TABLE,
    Item: {
      responseId: { S: data.responseId },
      reportId: { S: data.reportId },
      agencyName: { S: data.agencyName },
      status: { S: data.status },
      rejectReasonCode: { S: data.rejectReasonCode || "" },
      respondedAt: { S: data.now },
      createdAt: { S: data.now }
    }
  }

  await dynamoClient.send(new PutItemCommand(params))
}

async function updateReportHandled(reportId, agencyName) {

  const params = {
    TableName: TABLE_NAME,
    Key: { reportId: { S: reportId } },
    UpdateExpression: "SET assignedAgency = :agency, overallStatus = :status, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":agency": { S: agencyName },
      ":status": { S: "acknowledged" },
      ":updatedAt": { S: new Date().toISOString() }
    }
  }

  await dynamoClient.send(new UpdateItemCommand(params))
}

async function publishEventToSNS(body, reportId, createdAt, traceId) {

  const eventPayload = {
    eventType: "DamageReportForwarded",
    eventId: crypto.randomUUID(),
    traceId: traceId,
    occurredAt: new Date().toISOString(),
    data: {
      reportId: reportId,
      incidentId: body.incidentId,
      damageType: body.damageType,
      ownershipType: body.ownershipType,
      description: body.description,
      location: body.location,
      reporterName: body.reporterName,
      contactPhone: body.contactPhone,
      evidenceUrl: body.evidenceUrl || "",
      createdAt: createdAt
    }
  }

  const params = {
    TopicArn: TOPIC_ARN,
    Message: JSON.stringify(eventPayload)
  }

  const result = await snsClient.send(new PublishCommand(params))

  console.log("[publishEventToSNS] MessageId:", result.MessageId, "TraceId:", traceId)

  return result.MessageId
}

async function updateReportStatus(reportId) {

  const params = {
    TableName: TABLE_NAME,
    Key: { reportId: { S: reportId } },
    UpdateExpression: "SET overallStatus = :status, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":status": { S: "forwarded" },
      ":updatedAt": { S: new Date().toISOString() }
    }
  }

  await dynamoClient.send(new UpdateItemCommand(params))
}

// --- Validation ---

function validateInput(body) {

  const { incidentId, damageType, ownershipType, description, location, reporterName, contactPhone } = body

  if (!incidentId || !description || !location || !reporterName || !contactPhone) {
    throw new ValidationError("missing required field")
  }

  const validDamageType = ["building", "vehicle", "infrastructure", "utility", "other"]
  const validOwnershipType = ["personal", "public"]

  if (!validDamageType.includes(damageType)) {
    throw new ValidationError("invalid damageType")
  }

  if (!validOwnershipType.includes(ownershipType)) {
    throw new ValidationError("invalid ownershipType")
  }
}

// --- Response Builder ---

function createResponse(statusCode, body, traceId) {

  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
      "X-Trace-Id": traceId
    },
    body: JSON.stringify(body)
  }
}