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
    Invoke-RestMethod -Method $Method -Uri $Uri -ContentType $contentType -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 150
}

Write-Host '1. Tạo POI Phở Việt Nam'
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

Write-Host '2. Lưu nội dung tiếng Việt'
Send-Json 'Put' "$api/pois/$id/narrations/vi" @{
    text = 'Phở là một món ăn truyền thống nổi tiếng của Việt Nam. Một bát phở gồm bánh phở, nước dùng thơm và thịt bò hoặc thịt gà, ăn kèm rau thơm.'
} | ConvertTo-Json

if (-not $SkipTranslation) {
    Write-Host '3. Dịch thật VI sang EN/JA/KO bằng provider Stage 4'
    try {
        Send-Json 'Post' "$api/pois/$id/translations" @{ targetLanguages = @('en', 'ja', 'ko') } | ConvertTo-Json -Depth 6
    } catch {
        Write-Warning 'Chưa tạo được bản dịch. Kiểm tra LibreTranslate/.env. Script vẫn tạo audio VI; không thêm bản dịch giả.'
        if ($_.ErrorDetails.Message) { Write-Warning $_.ErrorDetails.Message }
    }
}

Write-Host '4. Tạo audio lần lượt VI / EN / JA / KO từ nội dung đã lưu'
foreach ($language in @('vi', 'en', 'ja', 'ko')) {
    try {
        $null = Invoke-RestMethod -Uri "$api/pois/$id/narrations/$language"
        $result = Invoke-RestMethod -Method Post -Uri "$api/pois/$id/narrations/$language/audio" -TimeoutSec 150
        $result | ConvertTo-Json
        # Chỉ dùng URL tương đối của Backend, không mở URL ngoài từ response.
        if ($result.audioUrl -notmatch '^/audio/[a-zA-Z0-9_-]+\.wav$') { throw 'Audio URL không hợp lệ' }
        $head = Invoke-WebRequest -Method Head -Uri ($BaseUrl.TrimEnd('/') + $result.audioUrl) -UseBasicParsing
        Write-Host "$language WAV: HTTP $($head.StatusCode), $($head.Headers['Content-Type']), $($head.Headers['Content-Length']) bytes"
    } catch {
        Write-Warning "Chưa hoàn thành audio $language. Nội dung phải tồn tại và Piper/model phải hoạt động."
        if ($_.ErrorDetails.Message) { Write-Warning $_.ErrorDetails.Message }
    }
}

Write-Host '5. GET tất cả narration và metadata audioFile'
Invoke-RestMethod -Uri "$api/pois/$id/narrations" | ConvertTo-Json -Depth 6
Write-Host '6. GET từng narration với audioUrl'
foreach ($language in @('vi', 'en', 'ja', 'ko')) {
    try { Invoke-RestMethod -Uri "$api/pois/$id/narrations/$language" | ConvertTo-Json }
    catch { Write-Warning "Chưa có narration $language." }
}

$latText = $Latitude.ToString([Globalization.CultureInfo]::InvariantCulture)
$lngText = $Longitude.ToString([Globalization.CultureInfo]::InvariantCulture)
Write-Host "Mở $BaseUrl, tải lại danh sách và dùng tọa độ $latText, $lngText."
Write-Host 'Kiểm tra vị trí giả lập, đổi VI / EN / JA / KO và tự bấm Play. Có thể bấm Tạo audio trên WebApp nếu còn thiếu WAV.'
Write-Host 'Không tự phát theo GPS. Mỗi lần chạy script tạo POI mới; chọn tọa độ riêng bằng -Latitude/-Longitude nếu đã có POI trùng vị trí.'
Write-Host "POI $id được giữ để demo; restart server sẽ mất metadata trong bộ nhớ. WAV đã tạo vẫn nằm trong public/audio và được Git ignore."
