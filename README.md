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

# Project Structure

```text
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
│   ├── lambda-getincident
│   │   └── index.js
│   │
│   └── lambda-request
│       └── index.js
│
└── proposal
    └── proposal.pdf
```

---

# API Endpoints
Base URL: https://k8wz4waf1f.execute-api.us-east-1.amazonaws.com/v1

# API Contract 1 — Create Damage Report

POST `/damage-reports`

ใช้สำหรับให้ประชาชนส่งรายงานความเสียหายเข้าสู่ระบบ เมื่อบันทึกสำเร็จ ระบบจะสร้างข้อมูลใน Damage Report Master Data และ publish event แบบ asynchronous เพื่อส่งต่อข้อมูลไปยังหน่วยงานที่เกี่ยวข้อง

ระบบรองรับการส่งคำร้องขอความช่วยเหลือฉุกเฉิน (rescueRequest) เพิ่มเติม เช่น การอพยพ หรือการช่วยเหลือทางการแพทย์

---

## Example 1 — Create Damage Report (Normal Report)

```http
POST /v1/damage-reports
```

### Request Body

```json
{
  "incidentId": "2FCBC2E0-5F71-44D1-A39B-15F0EDD5BB5C",
  "damageType": "building",
  "ownershipType": "personal",
  "description": "หลังคาบ้านพังเสียหายจากพายุ",
  "location": "123 ถนนสีลม บางรัก กรุงเทพมหานคร",
  "reporterName": "สมชาย ใจดี",
  "contactPhone": "0812345678",
  "latitude": 13.7563,
  "longitude": 100.5018,
  "evidenceUrl": "https://img.example.com/damage1.jpg"
}
```

### Example Response

```json
{
  "reportId": "REP-001",
  "overallStatus": "NEW",
  "createdAt": "2026-05-18T10:00:00Z"
}
```

---

## Example 2 — Create Damage Report with Rescue Request (MEDICAL)

```http
POST /v1/damage-reports
```

### Request Body

```json
{
  "incidentId": "2FCBC2E0-5F71-44D1-A39B-15F0EDD5BB5C",
  "damageType": "building",
  "ownershipType": "personal",
  "description": "บ้านพังเสียหายจากน้ำท่วม ติดอยู่ชั้น 2",
  "location": "123 ถนนสีลม บางรัก กรุงเทพมหานคร",
  "reporterName": "สมชาย ใจดี",
  "contactPhone": "0812345678",
  "latitude": 13.7563,
  "longitude": 100.5018,
  "evidenceUrl": "",
  "rescueRequest": {
    "requestType": "MEDICAL",
    "description": "ผู้ป่วยสูงอายุติดอยู่ชั้น 2 เดินไม่ได้ ต้องการความช่วยเหลือด่วน",
    "peopleCount": 2,
    "locationDetails": "บ้านสีเหลืองข้างต้นไทร",
    "province": "กรุงเทพมหานคร",
    "district": "บางรัก",
    "subdistrict": "บางรัก",
    "addressLine": "123 ถนนสีลม"
  }
}
```

### Example Response

```json
{
  "reportId": "REP-002",
  "overallStatus": "PENDING_RESCUE",
  "createdAt": "2026-05-18T10:10:00Z"
}
```

---

## Example 3 — Create Damage Report with Rescue Request (EVACUATION)

```http
POST /v1/damage-reports
```

### Request Body

```json
{
  "incidentId": "2FCBC2E0-5F71-44D1-A39B-15F0EDD5BB5C",
  "damageType": "infrastructure",
  "ownershipType": "public",
  "description": "ถนนพังทลาย น้ำท่วมสูง 2 เมตร ไม่สามารถออกได้",
  "location": "ซอยลาดพร้าว 101 กรุงเทพมหานคร",
  "reporterName": "วิชัย มีสุข",
  "contactPhone": "0891234567",
  "latitude": 13.8021,
  "longitude": 100.6235,
  "evidenceUrl": "",
  "rescueRequest": {
    "requestType": "EVACUATION",
    "description": "ครอบครัว 5 คน รวมเด็ก 2 คน ติดอยู่ในบ้าน น้ำสูงถึงชั้น 1",
    "peopleCount": 5,
    "locationDetails": "บ้านหลังที่ 3 นับจากปากซอย",
    "province": "กรุงเทพมหานคร",
    "district": "ลาดพร้าว",
    "subdistrict": "ลาดพร้าว",
    "addressLine": "ซอยลาดพร้าว 101"
  }
}
```

### Example Response

```json
{
  "reportId": "REP-003",
  "overallStatus": "PENDING_RESCUE",
  "createdAt": "2026-05-18T10:20:00Z"
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

# Features

* Create a damage report
* Retrieve a damage report by ID
* List all damage reports
* Handle agency responses
* Event-driven communication using SNS/SQS

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

