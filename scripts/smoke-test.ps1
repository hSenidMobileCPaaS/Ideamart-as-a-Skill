<#
.SYNOPSIS
    Ideamart smoke tests (Windows / PowerShell).

.DESCRIPTION
    Verifies credentials, IP whitelisting, and every provisioned endpoint.

    RUN THIS FROM THE SERVER THAT WILL CALL IDEAMART. Running it from a laptop
    tests the laptop's IP, which is not what you whitelisted — you will get
    E1303 and learn nothing.

    Credentials come from the environment. Never paste them into this file.

.EXAMPLE
    $env:IDEAMART_APP_ID = "APP_001807"
    $env:IDEAMART_PASSWORD = "..."
    .\scripts\smoke-test.ps1

.EXAMPLE
    .\scripts\smoke-test.ps1 -WithSms -TestMsisdn 94771234567
#>
[CmdletBinding()]
param(
    [switch]$WithSms,
    [switch]$WithCharge,
    [switch]$WithLbs,
    [string]$TestMsisdn = $(if ($env:TEST_MSISDN) { $env:TEST_MSISDN } else { "94771234567" })
)

# Load .env if present (KEY=VALUE lines).
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim('"').Trim()
        }
    }
}

if (-not $env:IDEAMART_APP_ID)   { throw "Set IDEAMART_APP_ID (see templates/.env.example)" }
if (-not $env:IDEAMART_PASSWORD) { throw "Set IDEAMART_PASSWORD (see templates/.env.example)" }

$baseUrl = if ($env:IDEAMART_BASE_URL) { $env:IDEAMART_BASE_URL.TrimEnd('/') } else { "https://api.ideamart.io" }
$lbsUrl  = if ($env:IDEAMART_LBS_URL)  { $env:IDEAMART_LBS_URL } else { "https://api.dialog.lk/lbs/locate" }

$script:Pass = 0
$script:Fail = 0

function Invoke-IdeamartCall {
    param([string]$Name, [string]$Url, [hashtable]$Body)

    Write-Host ("{0,-28}" -f $Name) -NoNewline

    $payload = ($Body + @{
        applicationId = $env:IDEAMART_APP_ID
        password      = $env:IDEAMART_PASSWORD
    }) | ConvertTo-Json -Depth 5 -Compress

    try {
        $response = Invoke-RestMethod -Uri $Url -Method Post `
            -ContentType 'application/json' -Body $payload -TimeoutSec 20
    }
    catch {
        Write-Host "NO RESPONSE" -ForegroundColor Red -NoNewline
        Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkGray
        $script:Fail++
        return
    }

    $code = $response.statusCode
    switch -Regex ($code) {
        '^S1000$' { Write-Host "S1000 OK" -ForegroundColor Green; $script:Pass++ }
        '^E1303$' { Write-Host "E1303" -ForegroundColor Red -NoNewline
                    Write-Host "  This IP is not whitelisted. Run: curl -4 https://myip.ideamart.io" -ForegroundColor DarkGray
                    $script:Fail++ }
        '^E1313$' { Write-Host "E1313" -ForegroundColor Red -NoNewline
                    Write-Host "  Auth failure - check IDEAMART_APP_ID / IDEAMART_PASSWORD" -ForegroundColor DarkGray
                    $script:Fail++ }
        '^E1309$' { Write-Host "E1309" -ForegroundColor Yellow -NoNewline
                    Write-Host "  Service not provisioned for this app" -ForegroundColor DarkGray
                    $script:Fail++ }
        '^E1351$' { Write-Host "E1351  Already registered (benign)" -ForegroundColor Green; $script:Pass++ }
        '^E1356$' { Write-Host "E1356  Not registered (benign for unregister)" -ForegroundColor Green; $script:Pass++ }
        default   { Write-Host "$code" -ForegroundColor Red -NoNewline
                    Write-Host "  $($response.statusDetail)" -ForegroundColor DarkGray
                    $script:Fail++ }
    }
}

function Skip-Test {
    param([string]$Name, [string]$Reason)
    Write-Host ("{0,-28}" -f $Name) -NoNewline
    Write-Host $Reason -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Ideamart smoke test"
Write-Host "  base URL   $baseUrl"
Write-Host "  app id     $($env:IDEAMART_APP_ID)"
Write-Host "  password   ***redacted***"
try {
    $egress = (Invoke-RestMethod -Uri "https://myip.ideamart.io" -TimeoutSec 10)
    Write-Host "  egress IP  $egress"
} catch {
    Write-Host "  egress IP  (could not determine)"
}
Write-Host "             ^ this must be in your app's Allowed Host Addresses"
Write-Host ""

Write-Host "-- Subscription --------------------------------"
Invoke-IdeamartCall "Query Base (base size)" "$baseUrl/subscription/query-base" @{}
Invoke-IdeamartCall "Get Status"             "$baseUrl/subscription/getStatus"  @{ subscriberId = "tel:$TestMsisdn" }
Invoke-IdeamartCall "Register (opt-in)"      "$baseUrl/subscription/send"       @{ version = "1.0"; action = "1"; subscriberId = "tel:$TestMsisdn" }
Invoke-IdeamartCall "Unregister (opt-out)"   "$baseUrl/subscription/send"       @{ version = "1.0"; action = "0"; subscriberId = "tel:$TestMsisdn" }

Write-Host ""
Write-Host "-- CaaS ----------------------------------------"
if ($env:IDEAMART_BALANCE_QUERY_ENABLED -ne "false") {
    Invoke-IdeamartCall "Query Balance" "$baseUrl/caas/balance/query" @{ subscriberId = "tel:$TestMsisdn"; currency = "LKR" }
} else {
    Skip-Test "Query Balance" "skipped (IDEAMART_BALANCE_QUERY_ENABLED=false)"
}

if ($WithCharge) {
    Write-Host "  !! This charges REAL MONEY from $TestMsisdn" -ForegroundColor Yellow
    $trxId = [guid]::NewGuid().ToString("N")
    Write-Host "  externalTrxId: $trxId  (persist this before charging, in real code)" -ForegroundColor DarkGray
    Invoke-IdeamartCall "Direct Debit (LKR 1)" "$baseUrl/caas/direct/debit" @{
        externalTrxId = $trxId; subscriberId = "tel:$TestMsisdn"; amount = "1"; currency = "LKR"
    }
} else {
    Skip-Test "Direct Debit" "skipped (-WithCharge to run - charges real money)"
}

Write-Host ""
Write-Host "-- SMS -----------------------------------------"
if ($WithSms) {
    Invoke-IdeamartCall "SMS Send" "$baseUrl/sms/send" @{
        destinationAddresses = @("tel:$TestMsisdn"); message = "Ideamart smoke test"
    }
} else {
    Skip-Test "SMS Send" "skipped (-WithSms to run - sends a real SMS)"
}

Write-Host ""
Write-Host "-- LBS -----------------------------------------"
if ($WithLbs) {
    Invoke-IdeamartCall "Locate" $lbsUrl @{ subscriberId = "tel:$TestMsisdn"; serviceType = "IMMEDIATE" }
} else {
    Skip-Test "Locate" "skipped (-WithLbs to run - requires consent)"
}

Write-Host ""
Write-Host "-----------------------------------------------"
Write-Host "  passed $($script:Pass)" -ForegroundColor Green -NoNewline
Write-Host "   failed $($script:Fail)" -ForegroundColor Red
Write-Host ""

if ($script:Fail -gt 0) { exit 1 }
