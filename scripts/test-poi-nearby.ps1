param(
    [string]$BaseUrl = 'http://localhost:3000'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$createdIds = New-Object 'System.Collections.Generic.List[string]'

function Assert-Condition {
    param([bool]$Condition, [string]$Message)

    if (-not $Condition) { throw "FAIL: $Message" }
    Write-Output "PASS: $Message"
}

function Invoke-JsonRequest {
    param([string]$Method, [string]$Uri, [hashtable]$Body)

    $json = $Body | ConvertTo-Json
    Invoke-RestMethod -Method $Method -Uri $Uri `
        -ContentType 'application/json; charset=utf-8' `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
}

function Assert-BadRequest {
    param([string]$Uri)

    try {
        $null = Invoke-RestMethod -Uri $Uri
        throw "Expected HTTP 400: $Uri"
    } catch {
        if ($null -eq $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 400) {
            throw
        }
        $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json
        Assert-Condition (-not [string]::IsNullOrWhiteSpace($errorBody.error)) "HTTP 400 with JSON error: $Uri"
    }
}

$health = Invoke-RestMethod -Uri "$BaseUrl/health"
Assert-Condition ($health.status -eq 'ok') 'GET /health'

# A fresh server makes the nearest/far assertions independent of old demo POIs.
$existing = Invoke-RestMethod -Uri "$BaseUrl/api/pois"
if (@($existing).Count -ne 0) {
    throw 'Run this demo on a freshly started server with an empty in-memory POI list.'
}

try {
    $poiA = Invoke-JsonRequest -Method Post -Uri "$BaseUrl/api/pois" -Body @{
        name = 'POI A'
        description = 'Food location A for the GPS demo.'
        latitude = 10.1234
        longitude = 106.1234
        geofenceRadius = 50
    }
    $createdIds.Add($poiA.id)
    Write-Output "Created POI A: $($poiA.id)"

    $poiB = Invoke-JsonRequest -Method Post -Uri "$BaseUrl/api/pois" -Body @{
        name = 'POI B'
        description = 'Food location B, about 111 metres north of A.'
        latitude = 10.1244
        longitude = 106.1234
        geofenceRadius = 50
    }
    $createdIds.Add($poiB.id)
    Write-Output "Created POI B: $($poiB.id)"

    $near = Invoke-RestMethod -Uri "$BaseUrl/api/pois/nearby?lat=10.1234&lng=106.1234"
    $near | ConvertTo-Json -Depth 5
    Assert-Condition ($near.insideGeofence -eq $true) 'GPS at A: insideGeofence = true'
    Assert-Condition ($near.nearestPoi.id -eq $poiA.id) 'nearestPoi is POI A'
    Assert-Condition ($near.nearestPoi.distance -eq 0) 'Same coordinates: distance = 0 metres'
    Assert-Condition (@($near.pois).Count -eq 1) 'Only A is inside the 50-metre geofence'

    $far = Invoke-RestMethod -Uri "$BaseUrl/api/pois/nearby?lat=0&lng=0"
    $far | ConvertTo-Json -Depth 5
    Assert-Condition ($far.insideGeofence -eq $false) 'Far GPS: insideGeofence = false'
    Assert-Condition ($null -eq $far.nearestPoi -and @($far.pois).Count -eq 0) 'Far GPS: nearestPoi = null, pois = []'

    $null = Invoke-JsonRequest -Method Put -Uri "$BaseUrl/api/pois/$($poiA.id)" -Body @{ isActive = $false }
    $inactive = Invoke-RestMethod -Uri "$BaseUrl/api/pois/nearby?lat=10.1234&lng=106.1234"
    Assert-Condition ($inactive.insideGeofence -eq $false) 'Inactive A does not trigger geofence'
    Assert-Condition ($null -eq $inactive.nearestPoi -and @($inactive.pois).Count -eq 0) 'Inactive A is excluded from pois and nearestPoi'

    Assert-BadRequest "$BaseUrl/api/pois/nearby?lng=106.1234"
    Assert-BadRequest "$BaseUrl/api/pois/nearby?lat=10.1234"
    Assert-BadRequest "$BaseUrl/api/pois/nearby?lat=abc&lng=106.1234"
    Assert-BadRequest "$BaseUrl/api/pois/nearby?lat=10.1234&lng=abc"
    Assert-BadRequest "$BaseUrl/api/pois/nearby?lat=91&lng=106.1234"
    Assert-BadRequest "$BaseUrl/api/pois/nearby?lat=10.1234&lng=181"

    Write-Output 'All GPS/geofence demo checks passed.'
} finally {
    # Delete only the POIs created by this script, including after a failed check.
    foreach ($poiId in $createdIds) {
        try {
            $null = Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/pois/$poiId"
        } catch {
            Write-Warning "Could not remove demo POI ${poiId}: $($_.Exception.Message)"
        }
    }
}
