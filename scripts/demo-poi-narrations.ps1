param(
    [string]$BaseUrl = 'http://localhost:3000',
    [double]$Latitude = 10.7769,
    [double]$Longitude = 106.7009,
    [switch]$SkipTranslation
)

$ErrorActionPreference = 'Stop'
$api = $BaseUrl.TrimEnd('/') + '/api'
$contentType = 'application/json; charset=utf-8'

function Send-Json([string]$Method, [string]$Uri, $Data) {
    $json = $Data | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Method $Method -Uri $Uri -ContentType $contentType -Body ([Text.Encoding]::UTF8.GetBytes($json))
}

Write-Host 'A. Tạo POI Phở Việt Nam'
$poi = Send-Json 'Post' "$api/pois" @{
    name = 'Phở Việt Nam'
    description = 'Điểm trải nghiệm món phở Việt Nam.'
    category = 'food'
    address = 'TP. Hồ Chí Minh'
    latitude = $Latitude
    longitude = $Longitude
    geofenceRadius = 80
    isActive = $true
}
$id = $poi.id
Write-Host "POI ID: $id"

Write-Host 'B. Lưu nội dung tiếng Việt'
Send-Json 'Put' "$api/pois/$id/narrations/vi" @{
    text = 'Phở là một trong những món ăn truyền thống nổi tiếng của Việt Nam. Một bát phở gồm bánh phở, nước dùng thơm và thịt bò hoặc thịt gà, ăn kèm rau thơm.'
} | ConvertTo-Json

Write-Host 'C. Đọc lại VI'
Invoke-RestMethod -Uri "$api/pois/$id/narrations/vi" | ConvertTo-Json

if (-not $SkipTranslation) {
    Write-Host 'D. Gọi provider thật để dịch EN/JA/KO'
    try {
        Send-Json 'Post' "$api/pois/$id/translations" @{ targetLanguages = @('en', 'ja', 'ko') } | ConvertTo-Json -Depth 6
        Write-Host 'E. Đọc lại từng bản dịch đã lưu'
        foreach ($language in @('en', 'ja', 'ko')) {
            Invoke-RestMethod -Uri "$api/pois/$id/narrations/$language" | ConvertTo-Json
        }
    } catch {
        Write-Warning 'Chưa hoàn thành bước dịch. Kiểm tra cấu hình/provider theo README rồi gọi lại API translations. VI vẫn được lưu; không có bản dịch giả.'
        if ($_.ErrorDetails.Message) { Write-Warning $_.ErrorDetails.Message }
    }
}

Write-Host 'Tất cả nội dung hiện có:'
Invoke-RestMethod -Uri "$api/pois/$id/narrations" | ConvertTo-Json -Depth 6
$latText = $Latitude.ToString([Globalization.CultureInfo]::InvariantCulture)
$lngText = $Longitude.ToString([Globalization.CultureInfo]::InvariantCulture)
Write-Host 'F. Kiểm tra geofence'
Invoke-RestMethod -Uri "$api/pois/nearby?lat=$latText&lng=$lngText" | ConvertTo-Json -Depth 6
Write-Host "Mở $BaseUrl, tải lại danh sách, giả lập latitude=$latText longitude=$lngText."
Write-Host 'Chọn VI / EN / JA / KO để đọc nội dung. Ngôn ngữ chưa lưu phải hiện thông báo thiếu.'
Write-Host "Giữ POI $id để demo WebApp; restart server sẽ mất dữ liệu trong bộ nhớ."
