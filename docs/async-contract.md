# Asynchronous Function Contract

This document describes **event-driven message contracts** used in the Property Damage Report Service.

The system uses **Amazon SNS and Amazon SQS** for asynchronous communication between services.

---

# Message Contract #1 — DamageReportForwarded

## General Information

| Field             | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Message Name      | DamageReportForwarded                                              |
| Interaction Style | Event-driven / Publish–Subscribe                                   |
| Message Broker    | Amazon SNS Topic → Amazon SQS                                      |
| Producer          | PropertyDamageReport Service                                       |
| Consumer          | Agency Services (LocalAuthorityService, DisasterManagementService) |
| Channel / Topic   | `damage-report.forwarded.v1`                                       |
| Version           | v1                                                                 |

---

## Description

This event is published after a citizen's damage report has been successfully stored in the database.

The **PropertyDamageReport Service** publishes the event to an **SNS Topic**, which distributes the message to multiple agency queues via **SQS**.

This enables **asynchronous event-driven communication** between services.

After the event is successfully published, the system updates the report status in the database to indicate that the report has been forwarded to relevant agencies.

---

## Event Publish Request

The event message is published to the SNS topic in JSON format.

### Message Body

```json
{
  "eventType": "DamageReportForwarded",
  "eventId": "a3d9c3e2-42e1-4e6e-b0d1-7f0cfa55b2d1",
  "occurredAt": "2026-02-21T10:00:00Z",
  "data": {
    "reportId": "REP-001",
    "incidentId": "INC-2026-01",
    "damageType": "building",
    "ownershipType": "personal",
    "description": "Roof damaged after storm",
    "location": "Rangsit, Pathum Thani",
    "reporterName": "Somchai Jaidee",
    "contactPhone": "0812345678",
    "evidenceUrl": "https://img.com/1.jpg",
    "createdAt": "2026-02-21T10:00:00Z"
  }
}
```

---

## Event Metadata

| Field      | Type     | Required | Description                  |
| ---------- | -------- | -------- | ---------------------------- |
| eventType  | string   | Y        | Event type                   |
| eventId    | UUID     | Y        | Unique event identifier      |
| occurredAt | datetime | Y        | Time when the event occurred |
| data       | object   | Y        | Damage report data           |

---

## Event Payload (`data`)

| Field         | Type     | Required | Description                          |
| ------------- | -------- | -------- | ------------------------------------ |
| reportId      | string   | Y        | Damage report ID                     |
| incidentId    | string   | Y        | Incident identifier                  |
| damageType    | enum     | Y        | Type of damage                       |
| ownershipType | enum     | Y        | Ownership type (`personal / public`) |
| location      | string   | Y        | Location of the damage               |
| description   | string   | Y        | Description of the damage            |
| reporterName  | string   | Y        | Name of the reporter                 |
| contactPhone  | string   | Y        | Contact phone number                 |
| evidenceUrl   | string   | N        | URL of evidence image                |
| createdAt     | datetime | Y        | Report creation timestamp            |

---

## Validation Rules

1. `reportId` must exist in the **Damage Report Master Data**
2. `incidentId` must not be empty
3. `location` must not be empty
4. `eventId` must be unique (idempotency check)

---

## Response Behavior

This is an **asynchronous event**, so there is **no synchronous response** returned to the producer.

Once the event is successfully published to the SNS Topic, the system considers the forwarding process completed.

Agency responses will be sent later via the API:

```
POST /v1/agency-responses
```

Those responses will be stored in the **AgencyResponses table**.

---

# Message Contract #2 — DamageReportAcknowledged

## General Information

| Field             | Value                            |
| ----------------- | -------------------------------- |
| Message Name      | DamageReportAcknowledged         |
| Interaction Style | Event-driven / Publish–Subscribe |
| Message Broker    | Amazon SNS Topic → Amazon SQS    |
| Producer          | PropertyDamageReport Service     |
| Consumer          | Agency Services                  |
| Channel / Topic   | `damage-report.acknowledged.v1`  |
| Version           | v1                               |

---

## Description

This event is published when an agency **accepts a damage report** via the synchronous API:

```
POST /v1/agency-responses
```

After the response is stored in the **AgencyResponses table** and the report status is updated in the **DamageReports table**, the system publishes this event.

The purpose is to notify other services that the report has already been handled by an agency.

Other services receiving this event may **ignore or stop processing the report**.

---

## Event Publish Request

### Message Body

```json
{
  "eventType": "DamageReportAcknowledged",
  "eventId": "c1c9fdd1-0f21-4f03-9f3a-9c0c82c7d211",
  "occurredAt": "2026-02-21T10:10:00Z",
  "data": {
    "reportId": "REP-001",
    "incidentId": "INC-2026-01",
    "assignedAgency": "DisasterManagementService",
    "acknowledgedAt": "2026-02-21T10:10:00Z"
  }
}
```

---

## Event Metadata

| Field      | Type     | Required | Description              |
| ---------- | -------- | -------- | ------------------------ |
| eventType  | string   | Y        | Event type               |
| eventId    | UUID     | Y        | Unique event identifier  |
| occurredAt | datetime | Y        | Event creation timestamp |
| data       | object   | Y        | Event payload            |

---

## Event Payload (`data`)

| Field          | Type     | Required | Description                                       |
| -------------- | -------- | -------- | ------------------------------------------------- |
| reportId       | string   | Y        | Damage report ID                                  |
| incidentId     | string   | Y        | Disaster incident ID                              |
| assignedAgency | string   | Y        | Agency that accepted the report                   |
| acknowledgedAt | datetime | Y        | Timestamp when the agency acknowledged the report |

---

## Validation Rules

1. `reportId` must exist in the **DamageReports table**
2. `assignedAgency` must not be empty
3. `eventId` must be unique (idempotency check)

---

## Response Behavior

This event uses **asynchronous event-driven communication**.

There is **no synchronous response** from consumer services.

Subscribed services will receive the event from their **SQS queues** and can update their internal processing logic accordingly.

For example, services may:

* stop evaluating the report
* ignore further related messages
* mark the report as already handled

---
