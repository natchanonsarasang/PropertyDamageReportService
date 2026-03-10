# Synchronous API Contract

**Base URL**

```
http://property-damage-report-service/v1
```

---

# API Contract #1 — Create Damage Report

## General Information

| Field  | Value                |
| ------ | -------------------- |
| Name   | Create damage report |
| Method | POST                 |
| Path   | /damage-reports      |
| Type   | Synchronous          |

## Description

Used by citizens to submit a property damage report to the system.

When the report is successfully stored:

1. The system saves the data to **Damage Report Master Data (DynamoDB)**
2. The system publishes an **asynchronous event** to notify relevant agencies.

---

## Request

### Path / Query Parameters

None

### Headers

```
Content-Type: application/json
```

### Request Body

```json
{
  "incidentId": "INC-2026-01",
  "damageType": "building",
  "ownershipType": "personal",
  "description": "Roof damaged after storm",
  "location": "Rangsit, Pathum Thani",
  "reporterName": "Somchai Jaidee",
  "contactPhone": "0812345678",
  "evidenceUrl": "https://img.com/1.jpg"
}
```

### Validation Rules

| Field         | Rule                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| incidentId    | required                                                                |
| damageType    | must be one of: `building / vehicle / infrastructure / utility / other` |
| ownershipType | must be `personal` or `public`                                          |
| description   | required                                                                |
| location      | required                                                                |
| reporterName  | required                                                                |
| contactPhone  | required                                                                |
| evidenceUrl   | optional but must be valid URL                                          |

---

## Response

### Success — 201 Created

```json
{
  "reportId": "REP-001",
  "overallStatus": "new",
  "createdAt": "2026-02-21T10:00:00Z"
}
```

### Error — 400 Bad Request

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "missing required field",
    "traceId": "uuid"
  }
}
```

---

## Dependency / Reliability

* Duplicate detection is implemented to support **idempotency**
* No synchronous dependency on external services
* Agency forwarding is handled via **asynchronous events**
* Maximum timeout: **≤ 30 seconds**

---

# API Contract #2 — Get Damage Report by ID

## General Information

| Field  | Value                      |
| ------ | -------------------------- |
| Name   | Get damage report detail   |
| Method | GET                        |
| Path   | /damage-reports/{reportId} |
| Type   | Synchronous                |

---

## Description

Retrieves the detailed information of a damage report using `reportId`.

---

## Request

### Path Parameter

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| reportId  | string | yes      |

### Headers

```
Accept: application/json
```

---

## Response

### Success — 200 OK

```json
{
  "reportId": "REP-1773151475212",
  "incidentId": "INC-2026-01",
  "damageType": "building",
  "ownershipType": "personal",
  "description": "Roof damaged after storm",
  "location": "Rangsit, Pathum Thani",
  "reporterName": "Somchai Jaidee",
  "contactPhone": "0812345678",
  "evidenceUrl": "https://img.com/1.jpg",
  "overallStatus": "acknowledged",
  "assignedAgency": "PathumThaniLocalAuthority",
  "createdAt": "2026-02-21T10:00:00Z",
  "updatedAt": "2026-02-21T10:10:00Z"
}
```

---

### Error — 400 Bad Request

```json
{
  "error": {
    "code": "INVALID_ID_FORMAT",
    "message": "invalid reportId format",
    "traceId": "uuid"
  }
}
```

### Error — 404 Not Found

```json
{
  "error": {
    "code": "REPORT_NOT_FOUND",
    "message": "reportId not found",
    "traceId": "uuid"
  }
}
```

---

## Dependency / Reliability

* Read-only operation
* No synchronous dependency with other services
* Reads directly from **DynamoDB**
* Maximum timeout: **≤ 30 seconds**
* Safe to retry (no side effects)

---

# API Contract #3 — List Damage Reports

## General Information

| Field  | Value               |
| ------ | ------------------- |
| Name   | List damage reports |
| Method | GET                 |
| Path   | /damage-reports     |
| Type   | Synchronous         |

---

## Description

Allows staff to retrieve a list of damage reports in the system.

Filtering by `overallStatus` is supported.

---

## Request

### Query Parameters

| Parameter     | Type   | Required                                    |
| ------------- | ------ | ------------------------------------------- |
| incidentId    | string | yes                                         |
| overallStatus | string | optional (`new / forwarded / acknowledged`) |

### Headers

```
Accept: application/json
```

---

## Response

### Success — 200 OK

```json
{
  "items": [
    {
      "reportId": "REP-1773151475212",
      "incidentId": "INC-2026-01",
      "description": "Roof damaged after storm",
      "contactPhone": "0812345678",
      "location": "Rangsit, Pathum Thani",
      "overallStatus": "forwarded",
      "assignedAgency": null,
      "createdAt": "2026-02-21T10:00:00Z"
    },
    {
      "reportId": "REP-1773152000000",
      "incidentId": "INC-2026-01",
      "description": "Flooded road",
      "contactPhone": "0891234567",
      "location": "Khlong Luang",
      "overallStatus": "acknowledged",
      "assignedAgency": "DisasterManagementService",
      "createdAt": "2026-02-21T11:00:00Z"
    }
  ]
}
```

---

## Dependency / Reliability

* Read-only operation (naturally idempotent)
* No external service dependency
* Query from **DynamoDB**
* Maximum timeout: **≤ 30 seconds**

---

# API Contract #4 — Agency Response

## General Information

| Field  | Value                           |
| ------ | ------------------------------- |
| Name   | Agency respond to damage report |
| Method | POST                            |
| Path   | /agency-responses               |
| Type   | Synchronous                     |

---

## Description

Allows an agency to **accept or reject** a damage report.

If the agency **accepts** the report:

* The system updates `overallStatus` to **acknowledged**
* The system publishes an **event** notifying other agencies.

---

## Request

### Headers

```
Content-Type: application/json
```

### Request Body

```json
{
  "reportId": "REP-1773151475212",
  "agencyName": "PathumThaniLocalAuthority",
  "status": "accepted"
}
```

### Validation Rules

| Field            | Rule                                            |
| ---------------- | ----------------------------------------------- |
| reportId         | must exist in DamageReports table               |
| agencyName       | required                                        |
| status           | must be `accepted` or `rejected`                |
| rejectReasonCode | optional but recommended when status = rejected |

---

## Response

### Success — Agency Accept

```json
{
  "message": "Agency response recorded",
  "responseId": "RESP-1773152000000",
  "reportId": "REP-1773151475212",
  "status": "accepted"
}
```

### Success — Agency Reject

```json
{
  "message": "Agency response recorded",
  "responseId": "RESP-1773153000000",
  "reportId": "REP-1773151475212",
  "status": "rejected"
}
```

### Example Reject Request

```json
{
  "reportId": "REP-1773151475212",
  "agencyName": "DisasterManagementService",
  "status": "rejected",
  "rejectReasonCode": "OUT_OF_JURISDICTION"
}
```

---

### Error — 400 Bad Request

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "missing required field",
    "traceId": "uuid"
  }
}
```

### Error — Invalid Status

```json
{
  "error": {
    "code": "INVALID_STATUS",
    "message": "status must be accepted or rejected",
    "traceId": "uuid"
  }
}
```

---

## Dependency / Reliability

* Synchronous API
* No synchronous dependency with other services
* Writes to **DynamoDB**
* Maximum timeout: **≤ 30 seconds**

---
