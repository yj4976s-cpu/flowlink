param(
  [Parameter(Mandatory = $true)][string]$SourceCsv,
  [Parameter(Mandatory = $true)][string]$OutputFile
)

$rows = Import-Csv -Encoding utf8 -LiteralPath $SourceCsv
$provinceOrder = @(
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시",
  "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전라남도",
  "경상북도", "경상남도", "제주특별자치도"
)
$gwangjuDistricts = @("동구", "서구", "남구", "북구", "광산구")

function Resolve-Province([object]$row) {
  if ($row.시도명 -ne "전남광주통합특별시") { return $row.시도명 }
  if ($gwangjuDistricts -contains $row.시군구명) { return "광주광역시" }
  return "전라남도"
}

$result = [System.Collections.Generic.List[object]]::new()
foreach ($provinceName in $provinceOrder) {
  $provinceRows = @($rows | Where-Object { (Resolve-Province $_) -eq $provinceName })
  $areaRows = @($provinceRows | Where-Object { $_.시군구명 -and -not $_.읍면동명 -and -not $_.리명 })
  $areaNames = @($areaRows | ForEach-Object { $_.시군구명 })
  $parentCities = @($areaNames | Where-Object {
    $candidate = $_
    $candidate.EndsWith("시") -and @($areaNames | Where-Object { $_ -ne $candidate -and $_.StartsWith($candidate) }).Count -gt 0
  })
  $children = [System.Collections.Generic.List[object]]::new()

  foreach ($area in $areaRows) {
    $areaName = $area.시군구명
    if (@($parentCities | Where-Object { $areaName -ne $_ -and $areaName.StartsWith($_) }).Count -gt 0) { continue }
    $districtRows = if ($parentCities -contains $areaName) {
      @($areaRows | Where-Object { $_.시군구명 -ne $areaName -and $_.시군구명.StartsWith($areaName) })
    } else { @() }

    if ($districtRows.Count -gt 0) {
      $districts = foreach ($district in $districtRows) {
        $towns = @($provinceRows | Where-Object { $_.시군구명 -eq $district.시군구명 -and $_.읍면동명 -and -not $_.리명 } | ForEach-Object { [ordered]@{ n = $_.읍면동명 } })
        [ordered]@{ n = $district.시군구명.Substring($areaName.Length); c = $towns }
      }
      $children.Add([ordered]@{ n = $areaName; c = @($districts) })
    } else {
      $towns = @($provinceRows | Where-Object { $_.시군구명 -eq $areaName -and $_.읍면동명 -and -not $_.리명 } | ForEach-Object { [ordered]@{ n = $_.읍면동명 } })
      $children.Add([ordered]@{ n = $areaName; c = $towns })
    }
  }
  $result.Add([ordered]@{ n = $provinceName; c = @($children) })
}

$json = $result | ConvertTo-Json -Depth 8 -Compress
$sourceNote = @"
// Generated from 국토교통부 전국 법정동 (2026-06-30), sourced from 행정표준코드관리시스템.
// The 2026 integrated 광주/전남 source rows are presented as the product-required 17 시·도 structure.
export type RegionDataNode = { n: string; c?: RegionDataNode[] };
export const KOREA_REGION_DATA = $json as RegionDataNode[];
"@
[IO.File]::WriteAllText($OutputFile, $sourceNote, [Text.UTF8Encoding]::new($false))
