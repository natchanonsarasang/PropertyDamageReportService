# Property Damage Report Service

PropertyDamageReport Service เป็นบริการที่รับผิดชอบการรับและจัดเก็บรายงานความเสียหายต่อทรัพย์สินจากประชาชนในระหว่างหรือหลังเหตุการณ์ภัยพิบัติ โดยทำหน้าที่เป็นจุดศูนย์กลางในการรวบรวมข้อมูลความเสียหาย เพื่อให้หน่วยงานรัฐสามารถตรวจสอบ จัดลำดับความสำคัญ และดำเนินการช่วยเหลือได้อย่างเป็นระบบ

# Service Owner
นาย ณัฐชนน สาระสังข์ รหัสนักศึกษา 6609611907 ภาคปกติ

# System Architecture
Main components:

* **API Gateway** – exposes REST endpoints
* **AWS Lambda** – handles business logic
* **DynamoDB** – stores damage report data
* **SNS / SQS** – enables asynchronous event processing
* **External agency service** – receives report events

---

# Features

* Create a damage report
* Retrieve a damage report by ID
* List all damage reports
* Handle agency responses
* Event-driven communication using SNS/SQS

---

# Project Structure

```
property-damage-report-service
│
├── README.md
├── architecture
│
├── docs
│   ├── api-contract.md
│   ├── async-contract.md
│   └── data-model.md
│
├── lambda
│   ├── createDamageReport.js
│
└── proposal
    └── proposal.pdf
```

---

# API Endpoints

## API Contract 1 Create Damage Report

POST `/damage-reports`

ใช้สำหรับให้ประชาชนส่งรายงานความเสียหายเข้าสู่ระบบ เมื่อบันทึกสำเร็จ ระบบจะสร้างข้อมูลใน Damage Report Master Data และหลังจากนั้นจะมีการ publish event แบบ asynchronous เพื่อส่งต่อหน่วยงานต่างๆที่เกี่ยวข้อง

Example request:

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

Example response:

```json
{
  "reportId": "REP-001",
  "overallStatus": "new",
  "createdAt": "2026-02-21T10:00:00Z"
}

```

---

## API Contract 2 Get Damage Report by ID

GET `/damage-reports/{reportId}`

ใช้ดึงรายละเอียดรายงานความเสียหายตาม reportId พร้อมสถานะปัจจุบัน

Example response:

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

## API Contract 3 List Damage Reports

GET `/damage-reports`

ใช้สำหรับให้ staff ดึงรายการรายงานความเสียหายทั้งหมดในระบบ สามารถ filter ตาม overallStatus ได้

Example response:

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
      "assignedAgency": none,
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

## API Contract 4 Agency Response

POST `/agency-responses`

ใช้สำหรับให้หน่วยงานตอบรับหรือปฏิเสธรายงานความเสียหาย ถ้าหน่วยงานตอบ accepted ระบบจะ
Update overallStatus เป็น acknowledge และ publish event เพื่อแจ้งให้หน่วยงานอื่นรู้ว่ารายงานนี้มีคนรับเรื่องแล้ว


Example request:

```json
{
"reportId": "REP-1773151475212",
"agencyName": "PathumThaniLocalAuthority",
"status": "accepted"
}

```

Example response Service Accept:

```json
{
"message": "Agency response recorded",
"responseId": "RESP-1773152000000",
"reportId": "REP-1773151475212",
"status": "accepted"
}

```

Example response Service Reject:

```json
{
  "message": "Agency response recorded",
  "responseId": "RESP-1773153000000",
  "reportId": "REP-1773151475212",
  "status": "rejected"
}


```
---

# API Documentation

ข้อมูล API Contract โดยละเอียดจะอยู่ใน

* `docs/api-contract.md`
* `docs/async-contract.md`

---

# Data Model

The damage report data is stored in **DynamoDB**.

See detailed schema documentation:

```
docs/data-model.md
```

---

# Event Flow

```text
Citizen
  │
POST /damage-reports
  │
  ▼
API Gateway
  │
  ▼
Lambda (createDamageReport)
  │
Save to DynamoDB
  │
Publish Event
  │
  ▼
SNS
  │
Fan-out
  │
  ▼
SQS (Agency queues)

```
Event details are documented in:

docs/async-contract.md


---

## Technologies Used

**Backend**
- Node.js
- AWS Lambda

**API Layer**
- Amazon API Gateway

**Database**
- Amazon DynamoDB

**Messaging / Event System**
- Amazon SNS
- Amazon SQS

---

