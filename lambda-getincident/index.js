const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb")

const dynamoClient = new DynamoDBClient({})

const INCIDENTS_TABLE = process.env.INCIDENTS_TABLE
const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY

exports.handler = async (event, context) => {

  const traceId = context.awsRequestId

  console.log("syncIncidents started", "TraceId:", traceId)

  try {

    const response = await fetch(EXTERNAL_API_URL, {
      method: "GET",
      headers: {
        "api-key": EXTERNAL_API_KEY,
        "X-IncidentTNX-Id": traceId
      }
    })

    if (!response.ok) {
      throw new Error(`External API responded with status ${response.status}`)
    }

    const incidents = await response.json()

    for (const incident of incidents) {
      await dynamoClient.send(new PutItemCommand({
        TableName: INCIDENTS_TABLE,
        Item: {
          incidentId: { S: incident.incident_id },
          incidentType: { S: incident.incident_type },
          incidentDescription: { S: incident.incident_description },
          location: { S: incident.exact_location_description || "" },
          status: { S: incident.status },
          priority: { S: incident.priority },
          syncedAt: { S: new Date().toISOString() }
        }
      }))
    }

    console.log(`Synced ${incidents.length} incidents`, "TraceId:", traceId)

    return {
      status: "SUCCESS",
      message: `Synced ${incidents.length} incidents`,
      traceId: traceId
    }

  } catch (error) {

    console.error("syncIncidents failed:", error.message, "TraceId:", traceId)

    
    return {
      status: "FAILED",
      message: error.message,
      traceId: traceId
    }
  }
}