const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb")

const client = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME

exports.handler = async (event) => {

  console.log("Incoming event:", JSON.stringify(event))

  const method = event.requestContext?.http?.method
  const path = event.rawPath

  try {

    // CORS Preflight
    if (method === "OPTIONS") {
      return createResponse(200, {})
    }

    // Create Damage Report
    if (method === "POST" && path === "/v1/damage-reports") {
      return await createDamageReport(event)
    }

    return createResponse(404, {
      message: "Route not found"
    })

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

  await saveToDynamo(body, reportId, createdAt)

  return createResponse(201, {
    reportId: reportId,
    overallStatus: "new",
    createdAt: createdAt
  })
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

async function saveToDynamo(body, reportId, createdAt) {

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
      overallStatus: { S: "new" },
      createdAt: { S: createdAt }
    }
  }

  const command = new PutItemCommand(params)

  await client.send(command)
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