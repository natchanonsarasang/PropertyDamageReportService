const { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb")
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns")
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs")
const crypto = require("crypto")

const dynamoClient = new DynamoDBClient({})
const snsClient = new SNSClient({})
const sqsClient = new SQSClient({})

const TABLE_NAME = process.env.TABLE_NAME
const AGENCY_RESPONSE_TABLE = process.env.AGENCY_RESPONSE_TABLE
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE
const TOPIC_ARN = process.env.TOPIC_ARN
const RESCUE_SERVICE_BASE_URL = process.env.RESCUE_SERVICE_BASE_URL
const RESCUE_RETRY_QUEUE_URL = process.env.RESCUE_RETRY_QUEUE_URL

// --- Structured Logger ---

const logger = {
  _log(level, message, fields = {}) {
    console.log(JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...fields
    }))
  },
  info(message, fields = {}) { this._log("INFO", message, fields) },
  warn(message, fields = {}) { this._log("WARN", message, fields) },
  error(message, fields = {}) { this._log("ERROR", message, fields) }
}

// --- Timer Utility ---

function startTimer() {
  const start = Date.now()
  return { elapsed() { return Date.now() - start } }
}

// --- Cold Start Log ---

logger.info("Lambda cold start initialized", {
  region: process.env.AWS_REGION,
  functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
  functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION
})

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
  const handlerTimer = startTimer()

  const method = event.requestContext?.http?.method
  const path = event.rawPath

  logger.info("Incoming request", {
    traceId,
    method,
    path,
    queryStringParameters: event.queryStringParameters || {},
    sourceIp: event.requestContext?.http?.sourceIp
  })

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

    const statusCode = error.statusCode || 500
    const code = error.code || "INTERNAL_ERROR"

    logger.error("Unhandled error", {
      traceId,
      method,
      path,
      errorName: error.name,
      errorCode: code,
      errorMessage: error.message,
      stack: error.stack,
      statusCode,
      totalDurationMs: handlerTimer.elapsed()
    })

    return createResponse(statusCode, {
      error: {
        code,
        message: error.message,
        traceId
      }
    }, traceId)

  } finally {

    logger.info("Request completed", {
      traceId,
      method,
      path,
      totalDurationMs: handlerTimer.elapsed()
    })
  }
}

// --- Route Handlers ---

async function getIncidents(event, traceId) {

  const timer = startTimer()
  logger.info("getIncidents start", { traceId })

  const result = await dynamoClient.send(new ScanCommand({ TableName: INCIDENTS_TABLE }))

  const items = (result.Items || []).map(item => ({
    incidentId: item.incidentId.S,
    incidentType: item.incidentType.S,
    incidentDescription: item.incidentDescription.S,
    location: item.location.S,
    status: item.status.S,
    priority: item.priority.S
  }))

  logger.info("getIncidents done", { traceId, count: items.length, durationMs: timer.elapsed() })

  return createResponse(200, { items }, traceId)
}

async function createDamageReport(event, traceId) {

  const timer = startTimer()
  logger.info("createDamageReport start", { traceId })

  const body = JSON.parse(event.body || "{}")

  logger.info("createDamageReport parsed body", {
    traceId,
    incidentId: body.incidentId,
    damageType: body.damageType,
    ownershipType: body.ownershipType,
    location: body.location,
    latitude: body.latitude,
    longitude: body.longitude,
    hasRescueRequest: !!body.rescueRequest
  })

  // Validate 

  validateInput(body)

  if (body.rescueRequest && typeof body.rescueRequest === "object") {
    logger.info("createDamageReport validating rescueRequest", { traceId })
    validateRescueRequest(body.rescueRequest, body.incidentId)
    logger.info("createDamageReport rescueRequest validation passed", { traceId })
  }

  // validate 

  const reportId = "REP-" + Date.now()
  const createdAt = new Date().toISOString()

  logger.info("createDamageReport generated reportId", { traceId, reportId })

  // Step 1 — Save damage report
  const step1Timer = startTimer()
  logger.info("Step 1: Saving damage report to DynamoDB", { traceId, reportId })
  await saveDamageReport(body, reportId, createdAt)
  logger.info("Step 1: Done", { traceId, reportId, durationMs: step1Timer.elapsed() })

  // Step 2 — Publish to SNS
  const step2Timer = startTimer()
  logger.info("Step 2: Publishing to SNS", { traceId, reportId })
  await publishEventToSNS(body, reportId, createdAt, traceId)
  logger.info("Step 2: Done", { traceId, reportId, durationMs: step2Timer.elapsed() })

  // Step 3 — Update status to forwarded
  const step3Timer = startTimer()
  logger.info("Step 3: Updating report status to forwarded", { traceId, reportId })
  await updateReportStatus(reportId)
  logger.info("Step 3: Done", { traceId, reportId, durationMs: step3Timer.elapsed() })

  // Step 4 — Optional: Forward rescue request
  let rescueResult = null

  if (body.rescueRequest && typeof body.rescueRequest === "object") {

    const step4Timer = startTimer()
    logger.info("Step 4: Forwarding to rescue service", {
      traceId,
      reportId,
      rescueServiceUrl: RESCUE_SERVICE_BASE_URL,
      requestType: body.rescueRequest.requestType,
      latitude: body.latitude,
      longitude: body.longitude
    })

    try {

      rescueResult = await forwardRescueRequest({
        rescueRequest: body.rescueRequest,
        incidentId: body.incidentId,
        reportId,
        reporterName: body.reporterName,
        contactPhone: body.contactPhone,
        latitude: body.latitude,
        longitude: body.longitude,
        traceId
      })

      logger.info("Step 4: Rescue service success", {
        traceId,
        reportId,
        requestId: rescueResult.requestId,
        trackingCode: rescueResult.trackingCode,
        status: rescueResult.status,
        submittedAt: rescueResult.submittedAt,
        durationMs: step4Timer.elapsed()
      })

      await updateReportWithRescueInfo(reportId, rescueResult)
      logger.info("Step 4: Rescue info saved to DynamoDB", { traceId, reportId })

    } catch (rescueError) {

      logger.error("Step 4: Rescue service failed", {
        traceId,
        reportId,
        errorName: rescueError.name,
        errorMessage: rescueError.message,
        rescueStatusCode: rescueError.statusCode,
        rescueErrorBody: rescueError.rescueErrorBody || null,
        stack: rescueError.stack,
        durationMs: step4Timer.elapsed()
      })

      // บันทึก rescue status = failed ลง DynamoDB
      await updateReportRescueFailed(reportId, rescueError)

      
      await enqueueRescueRetry({
        reportId,
        incidentId: body.incidentId,
        rescueRequest: body.rescueRequest,
        reporterName: body.reporterName,
        contactPhone: body.contactPhone,
        latitude: body.latitude,
        longitude: body.longitude,
        traceId
      })

      rescueResult = {
        error: true,
        message: rescueError.message,
        detail: rescueError.rescueErrorBody || null
      }
    }

  } else {
    logger.info("Step 4: No rescueRequest, skipping", { traceId, reportId })
  }

  

  const responseBody = {
    reportId,
    overallStatus: "forwarded",
    createdAt
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

  logger.info("createDamageReport done", {
    traceId,
    reportId,
    overallStatus: "forwarded",
    rescueForwarded: rescueResult ? !rescueResult.error : null,
    totalDurationMs: timer.elapsed()
  })

  return createResponse(201, responseBody, traceId)
}

async function getAllReports(event, traceId) {

  const timer = startTimer()

  const status = event.queryStringParameters?.status
  const contactPhone = event.queryStringParameters?.contactPhone

  logger.info("getAllReports start", { traceId, filters: { status, contactPhone } })

  const result = await dynamoClient.send(new ScanCommand({ TableName: TABLE_NAME }))

  const reports = (result.Items || []).map(item => ({
    reportId: item.reportId.S,
    incidentId: item.incidentId.S,
    damageType: item.damageType.S,
    ownershipType: item.ownershipType.S,
    description: item.description.S,
    location: item.location.S,
    latitude: item.latitude?.N ? parseFloat(item.latitude.N) : null,
    longitude: item.longitude?.N ? parseFloat(item.longitude.N) : null,
    reporterName: item.reporterName.S,
    contactPhone: item.contactPhone.S,
    evidenceUrl: item.evidenceUrl?.S || null,
    overallStatus: item.overallStatus.S,
    assignedAgency: item.assignedAgency?.S !== "none" ? item.assignedAgency?.S : null,
    rescueStatus: item.rescueStatus?.S || null,
    rescueFailReason: item.rescueFailReason?.S || null,
    rescueRequestId: item.rescueRequestId?.S || null,
    rescueTrackingCode: item.rescueTrackingCode?.S || null,
    rescueSubmittedAt: item.rescueSubmittedAt?.S || null,
    createdAt: item.createdAt.S,
    updatedAt: item.updatedAt?.S || null
  }))

  let filtered = reports
  if (status) filtered = filtered.filter(r => r.overallStatus === status)
  if (contactPhone) filtered = filtered.filter(r => r.contactPhone === contactPhone)

  logger.info("getAllReports done", {
    traceId,
    totalCount: reports.length,
    filteredCount: filtered.length,
    filters: { status, contactPhone },
    durationMs: timer.elapsed()
  })

  return createResponse(200, { items: filtered }, traceId)
}

async function getReportById(event, traceId) {

  const timer = startTimer()
  const reportId = event.pathParameters?.reportId

  logger.info("getReportById start", { traceId, reportId })

  const result = await dynamoClient.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: { reportId: { S: reportId } }
  }))

  if (!result.Item) {
    logger.warn("getReportById not found", { traceId, reportId, durationMs: timer.elapsed() })
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
    latitude: item.latitude?.N ? parseFloat(item.latitude.N) : null,  
    longitude: item.longitude?.N ? parseFloat(item.longitude.N) : null, 
    reporterName: item.reporterName.S,
    contactPhone: item.contactPhone.S,
    evidenceUrl: item.evidenceUrl?.S || null,
    overallStatus: item.overallStatus.S,
    assignedAgency: item.assignedAgency?.S !== "none" ? item.assignedAgency?.S : null,
    rescueStatus: item.rescueStatus?.S || null,          
    rescueFailReason: item.rescueFailReason?.S || null, 
    rescueRequestId: item.rescueRequestId?.S || null,
    rescueTrackingCode: item.rescueTrackingCode?.S || null, 
    rescueSubmittedAt: item.rescueSubmittedAt?.S || null,  
    createdAt: item.createdAt.S,
    updatedAt: item.updatedAt?.S || null                  
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

  logger.info("getReportById done", {
    traceId,
    reportId,
    overallStatus: responseBody.overallStatus,
    hasRescueRequest: !!item.rescueRequestId?.S,
    durationMs: timer.elapsed()
  })

  return createResponse(200, responseBody, traceId)
}

async function agencyResponse(event, traceId) {

  const timer = startTimer()
  logger.info("agencyResponse start", { traceId })

  const body = JSON.parse(event.body || "{}")

  const { reportId, agencyName, status, rejectReasonCode } = body

  logger.info("agencyResponse parsed body", { traceId, reportId, agencyName, status, rejectReasonCode })

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
    logger.info("agencyResponse: updating report as handled", { traceId, reportId, agencyName })
    await updateReportHandled(reportId, agencyName)
  }

  logger.info("agencyResponse done", {
    traceId,
    responseId,
    reportId,
    agencyName,
    status,
    durationMs: timer.elapsed()
  })

  return createResponse(200, {
    message: "Agency response recorded",
    responseId,
    reportId,
    status
  }, traceId)
}



const VALID_RESCUE_REQUEST_TYPES = ["MEDICAL", "EVACUATION", "SUPPLY"]

function validateRescueRequest(rescue, parentIncidentId) {
 
  const resolvedIncidentId = rescue.incidentId || parentIncidentId
  if (!resolvedIncidentId) {
    throw new ValidationError("rescueRequest missing required field: incidentId")
  }

  const required = ["requestType", "description"]
  for (const field of required) {
    if (rescue[field] === undefined || rescue[field] === null || rescue[field] === "") {
      throw new ValidationError(`rescueRequest missing required field: ${field}`)
    }
  }

  if (!VALID_RESCUE_REQUEST_TYPES.includes(rescue.requestType)) {
    throw new ValidationError(`rescueRequest.requestType must be one of: ${VALID_RESCUE_REQUEST_TYPES.join(", ")}`)
  }
  if (rescue.peopleCount !== undefined) {
    if (!Number.isInteger(rescue.peopleCount) || rescue.peopleCount < 1) {
      throw new ValidationError("rescueRequest.peopleCount must be a positive integer")
    }
  }
}

async function forwardRescueRequest({ rescueRequest, incidentId, reportId, reporterName, contactPhone, latitude, longitude, traceId }) {

  const payload = {
    incidentId: rescueRequest.incidentId || incidentId,
    requestType: rescueRequest.requestType,
    description: rescueRequest.description,
    peopleCount: rescueRequest.peopleCount || 1,
    latitude,
    longitude,
    contactName: reporterName,
    contactPhone,
    sourceChannel: "OTHER",
    specialNeeds: "",
    locationDetails: rescueRequest.locationDetails || null,
    province: rescueRequest.province || null,
    district: rescueRequest.district || null,
    subdistrict: rescueRequest.subdistrict || null,
    addressLine: rescueRequest.addressLine || null
  }

  const timer = startTimer()

  logger.info("forwardRescueRequest sending payload", {
    traceId,
    reportId,
    url: `${RESCUE_SERVICE_BASE_URL}/rescue-requests`,
    payload
  })

  const response = await fetch(`${RESCUE_SERVICE_BASE_URL}/rescue-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Trace-Id": traceId
    },
    body: JSON.stringify(payload)
  })

  const responseBody = await response.json()
  const durationMs = timer.elapsed()

  if (!response.ok) {
    logger.error("forwardRescueRequest failed", {
      traceId,
      reportId,
      httpStatus: response.status,
      responseBody,
      errorCode: responseBody?.error?.code || null,
      errorMessage: responseBody?.error?.message || null,
      durationMs
    })
    throw new RescueServiceError(
      `Rescue service returned ${response.status}`,
      response.status,
      responseBody?.error || responseBody || null
    )
  }

  logger.info("forwardRescueRequest success", {
    traceId,
    reportId,
    httpStatus: response.status,
    requestId: responseBody.requestId,
    trackingCode: responseBody.trackingCode,
    status: responseBody.status,
    durationMs
  })

  return {
    requestId: responseBody.requestId,
    trackingCode: responseBody.trackingCode,
    status: responseBody.status,
    submittedAt: responseBody.submittedAt
  }
}

async function enqueueRescueRetry({ reportId, incidentId, rescueRequest, reporterName, contactPhone, latitude, longitude, traceId }) {
  try {

    const rescuePayload = {
      incidentId: rescueRequest.incidentId || incidentId,
      requestType: rescueRequest.requestType,
      description: rescueRequest.description,
      peopleCount: rescueRequest.peopleCount || 1,
      latitude,
      longitude,
      contactName: reporterName,
      contactPhone,
      sourceChannel: "OTHER",
      specialNeeds: "",
      locationDetails: rescueRequest.locationDetails || null,
      province: rescueRequest.province || null,
      district: rescueRequest.district || null,
      subdistrict: rescueRequest.subdistrict || null,
      addressLine: rescueRequest.addressLine || null
    }

    const message = {
      reportId,
      traceId,
      enqueuedAt: new Date().toISOString(),
      rescuePayload
    }

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: RESCUE_RETRY_QUEUE_URL,
      MessageBody: JSON.stringify(message)
    }))

    logger.info("enqueueRescueRetry success", { traceId, reportId })

  } catch (sqsError) {
  
    logger.error("enqueueRescueRetry failed", {
      traceId,
      reportId,
      errorMessage: sqsError.message,
      stack: sqsError.stack
    })
  }
}

// --- DynamoDB Helpers ---

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
      latitude: { N: String(body.latitude) },
      longitude: { N: String(body.longitude) },
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

async function updateReportWithRescueInfo(reportId, rescueResult) {
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

async function updateReportRescueFailed(reportId, error) {
  const params = {
    TableName: TABLE_NAME,
    Key: { reportId: { S: reportId } },
    UpdateExpression: "SET rescueStatus = :rs, rescueFailReason = :reason, updatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":rs": { S: "failed" },
      ":reason": { S: error.message || "unknown error" },
      ":updatedAt": { S: new Date().toISOString() }
    }
  }
  await dynamoClient.send(new UpdateItemCommand(params))
}



async function publishEventToSNS(body, reportId, createdAt, traceId) {
  const eventPayload = {
    eventType: "DamageReportForwarded",
    eventId: crypto.randomUUID(),
    traceId,
    occurredAt: new Date().toISOString(),
    data: {
      reportId,
      incidentId: body.incidentId,
      damageType: body.damageType,
      ownershipType: body.ownershipType,
      description: body.description,
      location: body.location,
      reporterName: body.reporterName,
      contactPhone: body.contactPhone,
      evidenceUrl: body.evidenceUrl || "",
      createdAt
    }
  }

  const result = await snsClient.send(new PublishCommand({
    TopicArn: TOPIC_ARN,
    Message: JSON.stringify(eventPayload)
  }))

  logger.info("publishEventToSNS success", { traceId, reportId, messageId: result.MessageId })

  return result.MessageId
}

// --- Validation ---

function validateInput(body) {
  const { incidentId, damageType, ownershipType, description, location, reporterName, contactPhone, latitude, longitude } = body

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

  if (latitude === undefined || latitude === null) {
    throw new ValidationError("missing required field: latitude")
  }
  if (longitude === undefined || longitude === null) {
    throw new ValidationError("missing required field: longitude")
  }
  if (typeof latitude !== "number" || latitude < -90 || latitude > 90) {
    throw new ValidationError("latitude must be a number between -90 and 90")
  }
  if (typeof longitude !== "number" || longitude < -180 || longitude > 180) {
    throw new ValidationError("longitude must be a number between -180 and 180")
  }

  if (!/^\d{10}$/.test(contactPhone)) {
    throw new ValidationError("contactPhone must be a 10-digit number")
  }
}

// --- Response Builder ---

function createResponse(statusCode, body, traceId) {
  return {
    statusCode,
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