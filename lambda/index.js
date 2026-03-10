const { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb")
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns")
const crypto = require("crypto")

const dynamoClient = new DynamoDBClient({})
const snsClient = new SNSClient({})

const TABLE_NAME = process.env.TABLE_NAME
const AGENCY_RESPONSE_TABLE = process.env.AGENCY_RESPONSE_TABLE
const TOPIC_ARN = process.env.TOPIC_ARN

exports.handler = async (event) => {

  console.log("Incoming event:", JSON.stringify(event))

  const method = event.requestContext?.http?.method
  const path = event.rawPath

  try {

    if (method === "OPTIONS") {
      return createResponse(200, {})
    }

    if (method === "POST" && path === "/v1/damage-reports") {
      return await createDamageReport(event)
    }

    if (method === "GET" && path === "/v1/damage-reports") {
      return await getAllReports(event)
    }

    if (method === "GET" && path.startsWith("/v1/damage-reports/")) {
      return await getReportById(event)
    }

    if (method === "POST" && path === "/v1/agency-responses") {
      return await agencyResponse(event)
    }

    return createResponse(404, { message: "Route not found" })

  } catch (error) {

    console.error("Error:", error)

    return createResponse(500, {
      error: {
        code: "INTERNAL_ERROR",
        message: error.message
      }
    })
  }
}

async function createDamageReport(event) {

  const body = JSON.parse(event.body || "{}")

  validateInput(body)

  const reportId = "REP-" + Date.now()
  const createdAt = new Date().toISOString()

  await saveDamageReport(body, reportId, createdAt)

  await publishEventToSNS(body, reportId, createdAt)

  await updateReportStatus(reportId)

  return createResponse(201, {
    reportId: reportId,
    overallStatus: "forwarded",
    createdAt: createdAt
  })
}

async function getAllReports(event) {

  const status = event.queryStringParameters?.status

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

  const filtered = status
    ? reports.filter(r => r.overallStatus === status)
    : reports

  return createResponse(200, {
    reports: filtered
  })
}

async function getReportById(event) {

  const reportId = event.rawPath.split("/").pop()

  const params = {
    TableName: TABLE_NAME,
    Key: {
      reportId: { S: reportId }
    }
  }

  const result = await dynamoClient.send(new GetItemCommand(params))

  if (!result.Item) {
    return createResponse(404, { message: "Report not found" })
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
  })
}

async function agencyResponse(event) {

  const body = JSON.parse(event.body || "{}")

  const {
    reportId,
    agencyName,
    status,
    rejectReasonCode
  } = body

  if (!reportId || !agencyName || !status) {
    throw new Error("missing required field")
  }

  if (!["accepted", "rejected"].includes(status)) {
    throw new Error("invalid status")
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
  })
}

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

async function publishEventToSNS(body, reportId, createdAt) {

  const eventPayload = {
    eventType: "DamageReportForwarded",
    eventId: crypto.randomUUID(),
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

  console.log("SNS MessageId:", result.MessageId)

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
    throw new Error("missing required field")
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
    throw new Error("invalid damageType")
  }

  if (!validOwnershipType.includes(ownershipType)) {
    throw new Error("invalid ownershipType")
  }
}

function createResponse(statusCode, body) {

  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
    },
    body: JSON.stringify(body)
  }
}