const { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb")
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns")
const crypto = require("crypto")

const dynamoClient = new DynamoDBClient({})
const snsClient = new SNSClient({})

const TABLE_NAME = process.env.TABLE_NAME
const AGENCY_RESPONSE_TABLE = process.env.AGENCY_RESPONSE_TABLE
const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE
const TOPIC_ARN = process.env.TOPIC_ARN

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

// --- Handler ---

exports.handler = async (event, context) => {

  const traceId = context.awsRequestId

  console.log("Incoming event:", JSON.stringify(event))
  console.log("TraceId:", traceId)

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

    console.error("Error:", error, "TraceId:", traceId)

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

  return createResponse(200, { items }, traceId)
}

async function createDamageReport(event, traceId) {

  const body = JSON.parse(event.body || "{}")

  validateInput(body)

  const reportId = "REP-" + Date.now()
  const createdAt = new Date().toISOString()

  await saveDamageReport(body, reportId, createdAt)

  await publishEventToSNS(body, reportId, createdAt, traceId)

  await updateReportStatus(reportId)

  return createResponse(201, {
    reportId: reportId,
    overallStatus: "new",
    createdAt: createdAt
  }, traceId)
}

async function getAllReports(event, traceId) {

  const status = event.queryStringParameters?.status
  const contactPhone = event.queryStringParameters?.contactPhone

  const params = {
    TableName: TABLE_NAME
  }

  const result = await dynamoClient.send(new ScanCommand(params))

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

  return createResponse(200, {
    items: filtered
  }, traceId)
}

async function getReportById(event, traceId) {

  const reportId = event.pathParameters?.reportId

  const params = {
    TableName: TABLE_NAME,
    Key: {
      reportId: { S: reportId }
    }
  }

  const result = await dynamoClient.send(new GetItemCommand(params))

  if (!result.Item) {
    throw new NotFoundError("Report not found")
  }

  const item = result.Item

  return createResponse(200, {
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
  }, traceId)
}

async function agencyResponse(event, traceId) {

  const body = JSON.parse(event.body || "{}")

  const {
    reportId,
    agencyName,
    status,
    rejectReasonCode
  } = body

  if (!reportId || !agencyName || !status) {
    throw new ValidationError("missing required field")
  }

  if (!["accepted", "rejected"].includes(status)) {
    throw new ValidationError("invalid status")
  }

  const responseId = "RESP-" + Date.now()
  const now = new Date().toISOString()

  await saveAgencyResponse({
    responseId,
    reportId,
    agencyName,
    status,
    rejectReasonCode,
    now
  })

  if (status === "accepted") {
    await updateReportHandled(reportId, agencyName)
  }

  return createResponse(200, {
    message: "Agency response recorded",
    responseId: responseId,
    reportId: reportId,
    status: status
  }, traceId)
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
    Key: {
      reportId: { S: reportId }
    },
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

  console.log("SNS MessageId:", result.MessageId, "TraceId:", traceId)

  return result.MessageId
}

async function updateReportStatus(reportId) {

  const params = {
    TableName: TABLE_NAME,
    Key: {
      reportId: { S: reportId }
    },
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

  const {
    incidentId,
    damageType,
    ownershipType,
    description,
    location,
    reporterName,
    contactPhone
  } = body

  if (!incidentId || !description || !location || !reporterName || !contactPhone) {
    throw new ValidationError("missing required field")
  }

  const validDamageType = [
    "building",
    "vehicle",
    "infrastructure",
    "utility",
    "other"
  ]

  const validOwnershipType = [
    "personal",
    "public"
  ]

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