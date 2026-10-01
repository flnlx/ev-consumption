param([string]$WorkbookPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $WorkbookPath) { $WorkbookPath = Join-Path $root 'outputs/ev-consumption/纯电汽车电耗统计_B20261001.xlsx' }
$copy = Join-Path $root '.artifact/excel-reference.xlsx'
Copy-Item -LiteralPath $WorkbookPath -Destination $copy -Force
$inputs = Get-Content -LiteralPath (Join-Path $root '.artifact/excel-cases.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$app = New-Object -ComObject Excel.Application
$app.Visible = $false
$app.DisplayAlerts = $false
$book = $null
function Set-Value($Sheet, $Cell, $Value) {
    if ($null -eq $Value) { $Sheet.Range($Cell).ClearContents(); return }
    if ($Value -is [string]) { $Sheet.Range($Cell).Value2 = "'" + $Value; return }
    if ($Value -is [bool]) { $Sheet.Range($Cell).Value2 = $Value; return }
    $Sheet.Range($Cell).Value2 = [double]$Value
}
try {
    $book = $app.Workbooks.Open($copy, 0, $false)
    $overview = $book.Worksheets.Item('统计总览')
    $period = $book.Worksheets.Item('分期统计')
    $records = $book.Worksheets.Item('充电记录')
    $app.Calculation = -4135
    $results = New-Object Collections.Generic.List[object]
    foreach ($input in $inputs) {
        $records.Range('A7:F506').ClearContents()
        Set-Value $overview 'B4' $input.vehicle.batteryCapacityKwh
        Set-Value $overview 'B5' $input.vehicle.ratedRangeKm
        Set-Value $period 'B4' $input.view.grain
        Set-Value $period 'E4' $input.view.year
        foreach ($record in $input.chargingRecords) {
            $row = [int]$record.slot + 6
            foreach ($pair in @(@('A','dateValue'),@('B','odometerKm'),@('C','chargedKwh'),@('D','amountCny'),@('E','fullCharge'),@('F','note'))) { Set-Value $records ($pair[0] + $row) $record.($pair[1]) }
        }
        $app.CalculateFull()
        $full = @(); $all = @(); $counts = @(); $detail = @(); $periods = @()
        foreach ($row in 8..21) { $full += $overview.Range('B' + $row).Value2; $all += $overview.Range('C' + $row).Value2 }
        foreach ($row in 8..11) { $counts += $overview.Range('F' + $row).Value2 }
        foreach ($record in $input.chargingRecords) {
            $values = @()
            foreach ($column in @('G','H','I','J','K','L','M')) { $values += $records.Range($column + ([int]$record.slot + 6)).Value2 }
            $detail += @{ slot = $record.slot; values = $values }
        }
        $length = if ($input.view.grain -eq '月度') { 12 } elseif ($input.view.grain -eq '季度') { 4 } else { 5 }
        foreach ($row in 41..(40 + $length)) { $values = @(); foreach ($column in @('A','B','C','D','E','F','G','H','I','J','K')) { $values += $period.Range($column + $row).Value2 }; $periods += ,$values }
        $results.Add(@{ input = $input; full = $full; all = $all; counts = $counts; rows = $detail; periods = $periods })
        Write-Output ('Completed case ' + $results.Count)
    }
    $json = ConvertTo-Json -InputObject @($results.ToArray()) -Depth 15
    [IO.File]::WriteAllText((Join-Path $root '.artifact/excel-reference.json'), $json, (New-Object Text.UTF8Encoding($false)))
    Write-Output ('Excel reference cases: ' + $results.Count)
} finally {
    if ($book) { $book.Close($false) }
    $app.Quit()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
}
