## Create Damage Report

**Endpoint**

```
POST /v1/damage-reports
```

### Example Request #1

```json
{
  "incidentId": "INC-2026-01",
  "damageType": "building",
  "ownershipType": "personal",
  "description": "Roof partially collapsed after heavy storm",
  "location": "Rangsit, Pathum Thani",
  "reporterName": "Somchai Jaidee",
  "contactPhone": "0812345678",
  "evidenceUrl": "https://img.example.com/roof_damage1.jpg"
}
```

### Example Request #2

```json
{
  "incidentId": "INC-2026-01",
  "damageType": "vehicle",
  "ownershipType": "personal",
  "description": "Car windshield shattered due to falling tree branch",
  "location": "Bang Khen, Bangkok",
  "reporterName": "Anan Prasert",
  "contactPhone": "0891122334",
  "evidenceUrl": "https://img.example.com/car_damage1.jpg"
}
```

### Example Request #3

```json
{
  "incidentId": "INC-2026-02",
  "damageType": "infrastructure",
  "ownershipType": "public",
  "description": "Road surface damaged after flash flood",
  "location": "Chiang Mai City",
  "reporterName": "Municipal Officer",
  "contactPhone": "053123456",
  "evidenceUrl": "https://img.example.com/road_damage1.jpg"
}
```

### Example Request #4

```json
{
  "incidentId": "INC-2026-03",
  "damageType": "utility",
  "ownershipType": "public",
  "description": "Electric pole leaning dangerously after storm",
  "location": "Hat Yai, Songkhla",
  "reporterName": "Local Resident",
  "contactPhone": "0815566778",
  "evidenceUrl": "https://img.example.com/pole_damage1.jpg"
}
```

### Example Request #5

```json
{
  "incidentId": "INC-2026-04",
  "damageType": "other",
  "ownershipType": "personal",
  "description": "Fence collapsed due to strong winds",
  "location": "Nakhon Ratchasima",
  "reporterName": "Suda Wong",
  "contactPhone": "0829988776",
  "evidenceUrl": "https://img.example.com/fence_damage1.jpg"
}
```

---

# Get Damage Report by ID

Endpoint

```
GET /damage-reports/{reportId}
```

### Example Request #1

```
GET /damage-reports/REP-1773151475212
```

### Example Response

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
  "overallStatus": "forwarded",
  "assignedAgency": null,
  "createdAt": "2026-02-21T10:00:00Z",
  "updatedAt": "2026-02-21T10:02:00Z"
}
```

---

### Example Request #2

```
GET /damage-reports/REP-1773152000000
```

### Example Response

```json
{
  "reportId": "REP-1773152000000",
  "incidentId": "INC-2026-02",
  "damageType": "vehicle",
  "ownershipType": "personal",
  "description": "Car damaged by fallen tree",
  "location": "Bang Khen, Bangkok",
  "reporterName": "Anan Prasert",
  "contactPhone": "0891122334",
  "evidenceUrl": "https://img.example.com/car_damage1.jpg",
  "overallStatus": "acknowledged",
  "assignedAgency": "DisasterManagementService",
  "createdAt": "2026-02-21T11:00:00Z",
  "updatedAt": "2026-02-21T11:10:00Z"
}
```

---

# List Damage Reports

Endpoint

```
GET /damage-reports
```

### Example Request #1

```
GET /damage-reports?incidentId=INC-2026-01
```

### Example Response

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

### Example Request #2

```
GET /damage-reports?incidentId=INC-2026-01&overallStatus=acknowledged
```

### Example Response

```json
{
  "items": [
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

# Agency Response

Endpoint

```
POST /agency-responses
```

### Example Request #1 — Accept Report

```json
{
  "reportId": "REP-1773151475212",
  "agencyName": "PathumThaniLocalAuthority",
  "status": "accepted"
}
```

### Example Response

```json
{
  "message": "Agency response recorded",
  "responseId": "RESP-1773152000000",
  "reportId": "REP-1773151475212",
  "status": "accepted"
}
```

---

### Example Request #2 — Reject Report

```json
{
  "reportId": "REP-1773151475212",
  "agencyName": "DisasterManagementService",
  "status": "rejected",
  "rejectReasonCode": "OUT_OF_JURISDICTION"
}
```

### Example Response

```json
{
  "message": "Agency response recorded",
  "responseId": "RESP-1773153000000",
  "reportId": "REP-1773151475212",
  "status": "rejected"
}
```
