# Data Model

This document describes the **data storage design** used by the Property Damage Report Service.

All tables are **owned and managed by this service** and stored in **Amazon DynamoDB**.

---

# 1. DamageReports (Master Data)

This table stores the main **damage report information submitted by citizens**.

Each record represents a single report describing property damage caused by a disaster.

## Table Information

| Property    | Value                        |
| ----------- | ---------------------------- |
| Table Name  | DamageReports                |
| Primary Key | reportId                     |
| Data Owner  | PropertyDamageReport Service |

---

## Field Definition

| Field Name     | Type     | Required | Description                                                            | Example                   |
| -------------- | -------- | -------- | ---------------------------------------------------------------------- | ------------------------- |
| reportId       | string   | Y (PK)   | Damage report identifier                                               | REP-001                   |
| incidentId     | string   | Y        | Disaster incident identifier                                           | INC-2026-01               |
| damageType     | enum     | Y        | Type of damage (building / vehicle / infrastructure / utility / other) | building                  |
| ownershipType  | enum     | Y        | Property ownership type (personal / public)                            | personal                  |
| description    | string   | Y        | Description of the damage                                              | Roof damaged after storm  |
| location       | string   | Y        | Location where the damage occurred                                     | Rangsit, Pathum Thani     |
| reporterName   | string   | Y        | Name of the reporter                                                   | Somchai Jaidee            |
| contactPhone   | string   | Y        | Reporter contact phone                                                 | 0812345678                |
| evidenceUrl    | string   | N        | URL of supporting evidence image                                       | https://img.com/1.jpg     |
| overallStatus  | enum     | Y        | Report processing status (new / forwarded / acknowledged)              | forwarded                 |
| assignedAgency | string   | N        | Agency assigned to handle the report                                   | DisasterManagementService |
| createdAt      | datetime | Y        | Report creation timestamp                                              | 2026-02-21T10:00:00Z      |
| updatedAt      | datetime | Y        | Last update timestamp                                                  | 2026-02-21T10:02:00Z      |

---

# 2. EventPublishLog

This table records events that were published to **SNS topics**.

It is primarily used for:

* event tracing
* debugging
* reliability auditing

## Table Information

| Property    | Value                        |
| ----------- | ---------------------------- |
| Table Name  | EventPublishLog              |
| Primary Key | eventId                      |
| Data Owner  | PropertyDamageReport Service |

---

## Field Definition

| Field Name  | Type     | Required | Description                    | Example                    |
| ----------- | -------- | -------- | ------------------------------ | -------------------------- |
| eventId     | string   | Y (PK)   | Unique event identifier (UUID) | uuid-1234-abcd             |
| reportId    | string   | Y        | Related damage report          | REP-001                    |
| eventType   | string   | Y        | Event type name                | DamageReportForwarded      |
| topicName   | string   | Y        | SNS topic name                 | damage-report.forwarded.v1 |
| messageId   | string   | Y        | Message ID returned from SNS   | a9f23c88-9b21-4eab         |
| publishedAt | datetime | Y        | Time when event was published  | 2026-02-21T10:03:00Z       |
| createdAt   | datetime | Y        | Time when log was recorded     | 2026-02-21T10:03:00Z       |

---

# 3. AgencyResponses

This table stores responses from agencies regarding a damage report.

Multiple agencies may respond to the same report.

## Table Information

| Property    | Value                        |
| ----------- | ---------------------------- |
| Table Name  | AgencyResponses              |
| Primary Key | responseId                   |
| Data Owner  | PropertyDamageReport Service |

---

## Field Definition

| Field Name       | Type     | Required | Description                           | Example                   |
| ---------------- | -------- | -------- | ------------------------------------- | ------------------------- |
| responseId       | string   | Y (PK)   | Response identifier                   | RESP-001                  |
| reportId         | string   | Y        | Associated damage report              | REP-001                   |
| agencyName       | string   | Y        | Name of responding agency             | DisasterManagementService |
| status           | enum     | Y        | Response status (accepted / rejected) | accepted                  |
| rejectReasonCode | string   | N        | Reason for rejection                  | Out of scope              |
| respondedAt      | datetime | Y        | Time when the agency responded        | 2026-02-21T10:05:00Z      |
| createdAt        | datetime | Y        | Time when record was stored           | 2026-02-21T10:05:00Z      |

---

# Data Relationships

```text
DamageReports
    │
    │ reportId
    │
    ├── EventPublishLog
    │       └── eventId
    │
    └── AgencyResponses
            └── responseId
```

A single **Damage Report** may generate:

* multiple **agency responses**

---

# Storage Technology

The service uses **Amazon DynamoDB** to store all tables.

Benefits:

* high scalability
* serverless architecture compatibility
* low latency reads and writes
* suitable for event-driven systems

---
