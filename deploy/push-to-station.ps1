<#
.SYNOPSIS
    Заливка пульта на колонку по SSH и установка — одной командой.

.DESCRIPTION
    На станции нет sftp-server и бинарника scp, а BusyBox tar не умеет -z,
    поэтому архив передаётся потоком в stdin команды ssh.

    Адрес колонки определяется автоматически: сохранённый, из known_hosts,
    из ARP-таблицы, затем скан подсети по порту SSH. Если кандидатов
    несколько — скрипт спросит, какую использовать.

    После заливки сразу запускается deploy/install.sh (отключается -NoInstall).

.EXAMPLE
    .\deploy\push-to-station.ps1

.EXAMPLE
    .\deploy\push-to-station.ps1 -Station 192.168.1.100 -Message "fix: громкость"

.EXAMPLE
    .\deploy\push-to-station.ps1 -NoInstall -SkipUpload
#>

[CmdletBinding()]
param(
    # Если не указан — находится автоматически
    [string]$Station,

    [int]$Port = 2222,

    [string]$User = 'root',

    [string]$Target = '/tmp/mypult-src',

    # Не запускать install.sh после заливки
    [switch]$NoInstall,

    # Не поднимать версию перед заливкой
    [switch]$NoBump,

    # Только собрать архив, никуда не отправлять
    [switch]$SkipUpload,

    # Не использовать сохранённый адрес и не сканировать сеть
    [switch]$NoScan,

    # Строка для CHANGELOG при автоподъёме версии
    [string]$Message = 'заливка на колонку'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$savedFile = Join-Path $root '.mypult-station'

function Write-Step([string]$Text) {
    Write-Host ('==> ' + $Text) -ForegroundColor Cyan
}

function Write-Warn([string]$Text) {
    Write-Host ('[!] ' + $Text) -ForegroundColor Yellow
}

# Любая ошибка — одна понятная красная строка вместо стектрейса,
# плюс копия в push.log: окно могло закрыться раньше, чем её прочитали.
trap {
    Write-Host ''
    Write-Host ('ОШИБКА: ' + $_.Exception.Message) -ForegroundColor Red
    try {
        $log = Join-Path $root 'push.log'
        $where = $_.InvocationInfo.PositionMessage
        ('{0}  ОШИБКА: {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_.Exception.Message) |
            Add-Content -Path $log -Encoding UTF8
        if ($where) { $where | Add-Content -Path $log -Encoding UTF8 }
        Write-Host ('Подробности записаны в ' + $log) -ForegroundColor DarkGray
    } catch { }
    exit 1
}

foreach ($tool in @('tar', 'ssh')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "не найдена команда '$tool' — она должна быть в PATH (ssh входит в Windows 10+)"
    }
}

# --------------------------------------------------------------------------- #
#  Поиск колонки
# --------------------------------------------------------------------------- #

function Test-TcpPort {
    param([string]$ComputerName, [int]$PortNumber, [int]$TimeoutMs = 400)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync($ComputerName, $PortNumber)
        if ($task.Wait($TimeoutMs) -and $client.Connected) { return $true }
        return $false
    } catch {
        return $false
    } finally {
        try { $client.Close() } catch { }
    }
}

function Get-LocalPrefixes {
    $prefixes = @()
    try {
        $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop
    } catch {
        return $prefixes
    }
    foreach ($address in $addresses) {
        if ($address.IPAddress -like '127.*' -or $address.IPAddress -like '169.254.*') { continue }
        if ($address.PrefixLength -lt 24) { continue }   # /16 и шире не сканируем
        $octets = $address.IPAddress.Split('.')
        $prefixes += (($octets[0..2] -join '.') + '.')
    }
    return ($prefixes | Select-Object -Unique)
}

function Get-LocalAddresses {
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Select-Object -ExpandProperty IPAddress
    } catch {
        @()
    }
}

function Scan-Subnet {
    param([string]$Prefix)

    $local = Get-LocalAddresses
    $entries = New-Object System.Collections.ArrayList

    foreach ($i in 1..254) {
        $ip = "$Prefix$i"
        if ($local -contains $ip) { continue }
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $task = $client.ConnectAsync($ip, $Port)
        } catch {
            try { $client.Close() } catch { }
            continue
        }
        [void]$entries.Add([pscustomobject]@{ Ip = $ip; Client = $client; Task = $task })
    }

    Start-Sleep -Milliseconds 700

    $open = @()
    foreach ($entry in $entries) {
        $alive = $false
        try { $alive = $entry.Task.IsCompleted -and $entry.Client.Connected } catch { }
        if ($alive) { $open += $entry.Ip }
        try { $entry.Client.Close() } catch { }
    }
    return $open
}

function Test-ManyPorts {
    param([string[]]$Addresses, [int]$PortNumber, [int]$TimeoutMs = 700)

    $tasks = @()
    foreach ($ip in $Addresses) {
        if (-not $ip) { continue }
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $task = $client.ConnectAsync($ip, $PortNumber)
        } catch {
            try { $client.Close() } catch { }
            continue
        }
        $tasks += [pscustomobject]@{ Ip = $ip; Client = $client; Task = $task }
    }

    Start-Sleep -Milliseconds $TimeoutMs

    $open = @()
    foreach ($entry in $tasks) {
        $alive = $false
        try { $alive = $entry.Task.IsCompleted -and $entry.Client.Connected } catch { }
        if ($alive) { $open += $entry.Ip }
        try { $entry.Client.Close() } catch { }
    }
    return $open
}

function Get-Candidates {
    $found = New-Object System.Collections.ArrayList
    $seen = @{}

    if (-not $NoScan -and (Test-Path $savedFile)) {
        $ip = (Get-Content $savedFile -Raw).Trim()
        if ($ip) {
            [void]$found.Add([pscustomobject]@{ Ip = $ip; Source = 'сохранённый адрес' })
            $seen[$ip] = $true
        }
    }

    $knownHosts = Join-Path $env:USERPROFILE '.ssh\known_hosts'
    if (Test-Path $knownHosts) {
        $text = Get-Content $knownHosts -Raw
        foreach ($match in [regex]::Matches($text, '\[([0-9]{1,3}(?:\.[0-9]{1,3}){3})\]:' + $Port)) {
            $ip = $match.Groups[1].Value
            if (-not $seen.ContainsKey($ip)) {
                [void]$found.Add([pscustomobject]@{ Ip = $ip; Source = 'known_hosts' })
                $seen[$ip] = $true
            }
        }
    }

    try {
        $arp = (arp -a) -join "`n"
        foreach ($match in [regex]::Matches($arp, '\b([0-9]{1,3}(?:\.[0-9]{1,3}){3})\b')) {
            $ip = $match.Groups[1].Value
            if ($ip -like '224.*' -or $ip -like '239.*' -or $ip -like '255.*') { continue }
            if ($ip.EndsWith('.255') -or $ip.EndsWith('.0')) { continue }
            if (-not $seen.ContainsKey($ip)) {
                [void]$found.Add([pscustomobject]@{ Ip = $ip; Source = 'ARP' })
                $seen[$ip] = $true
            }
        }
    } catch { }

    # оставляем только те, где реально открыт SSH-порт (параллельно)
    $alive = @()
    if ($found.Count -gt 0) {
        $aliveIps = Test-ManyPorts -Addresses @($found | ForEach-Object { $_.Ip }) -PortNumber $Port
        foreach ($item in $found) {
            if ($aliveIps -contains $item.Ip) { $alive += $item }
        }
    }

    if ($alive.Count -eq 0 -and -not $NoScan) {
        foreach ($prefix in (Get-LocalPrefixes)) {
            Write-Step "скан подсети ${prefix}0/24 по порту $Port"
            foreach ($ip in (Scan-Subnet -Prefix $prefix)) {
                if (-not $seen.ContainsKey($ip)) {
                    $alive += [pscustomobject]@{ Ip = $ip; Source = 'скан сети' }
                    $seen[$ip] = $true
                }
            }
        }
    }

    foreach ($item in $alive) {
        $item | Add-Member -NotePropertyName Luna -NotePropertyValue (Test-TcpPort -ComputerName $item.Ip -PortNumber 8099 -TimeoutMs 500) -Force
    }

    return @($alive | Sort-Object -Property @{ Expression = { $_.Luna }; Descending = $true })
}

function Select-Station {
    if ($Station) { return $Station }

    if ($NoScan) {
        $Station = Read-Host 'IP колонки (например 192.168.1.100)'
        if (-not $Station) { throw 'не указан адрес колонки: -Station 192.168.1.100' }
        return $Station
    }

    Write-Step 'ищу колонку в сети'
    $candidates = @(Get-Candidates)

    if ($candidates.Count -eq 0) {
        Write-Warn 'автоматически найти не удалось'
        $Station = Read-Host 'IP колонки (например 192.168.1.100)'
        if (-not $Station) { throw 'не указан адрес колонки' }
        return $Station
    }

    if ($candidates.Count -eq 1) {
        $chosen = $candidates[0]
        $luna = if ($chosen.Luna) { 'да' } else { 'нет' }
        Write-Host ("найдена колонка: {0} ({1}, Luna: {2})" -f $chosen.Ip, $chosen.Source, $luna)
        return $chosen.Ip
    }

    Write-Host 'найдено несколько устройств с открытым SSH:'
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        $item = $candidates[$i]
        $luna = if ($item.Luna) { 'да' } else { 'нет' }
        Write-Host ("  {0}) {1,-15} Luna: {2,-3} ({3})" -f ($i + 1), $item.Ip, $luna, $item.Source)
    }

    do {
        $answer = Read-Host ("какую использовать? [1-" + $candidates.Count + ", Enter = 1]")
        if (-not $answer) { $answer = '1' }
        $number = 0
        $ok = [int]::TryParse($answer, [ref]$number)
    } while (-not $ok -or $number -lt 1 -or $number -gt $candidates.Count)

    return $candidates[$number - 1].Ip
}

# --------------------------------------------------------------------------- #
#  Сборка и отправка
# --------------------------------------------------------------------------- #

$Station = Select-Station
Write-Step ("колонка: {0}@{1}:{2}" -f $User, $Station, $Port)

try {
    Set-Content -Path $savedFile -Value $Station -Encoding ascii
} catch { }

$items = @('index.html', 'index.py', 'manifest.json', 'icon.svg', 'version.json', 'CHANGELOG.md', 'cgi-bin', 'lighttpd', 'init.d', 'deploy', 'service', 'README.md')

Write-Host "источник: $root"

function Get-ContentHash {
    param([string]$Base, [string[]]$Entries)

    $files = New-Object System.Collections.ArrayList
    foreach ($entry in $Entries) {
        $path = Join-Path $Base $entry
        if (Test-Path $path -PathType Leaf) {
            [void]$files.Add((Get-Item $path))
        } else {
            foreach ($file in (Get-ChildItem $path -Recurse -File)) {
                if ($file.Extension -eq '.pyc' -or $file.FullName -match '__pycache__') { continue }
                [void]$files.Add($file)
            }
        }
    }

    $sha = [Security.Cryptography.SHA256]::Create()
    $buffer = New-Object System.IO.MemoryStream
    foreach ($file in ($files | Sort-Object FullName)) {
        $rel = $file.FullName.Substring($Base.Length + 1).Replace('\', '/')
        $nameBytes = [Text.Encoding]::UTF8.GetBytes($rel + "`n")
        $buffer.Write($nameBytes, 0, $nameBytes.Length)
        $data = [IO.File]::ReadAllBytes($file.FullName)
        $buffer.Write($data, 0, $data.Length)
        $buffer.WriteByte(0)
    }
    $hash = $sha.ComputeHash($buffer.ToArray())
    $buffer.Dispose()
    $sha.Dispose()
    return (([BitConverter]::ToString($hash)).Replace('-', '')).ToLower()
}

$hashFile = Join-Path $root '.mypult-hash'
# version.json и CHANGELOG меняются самим подъёмом версии, поэтому в хэш
# содержимого они не входят — иначе каждый залив считался бы изменением.
$hashItems = @($items | Where-Object { $_ -ne 'version.json' -and $_ -ne 'CHANGELOG.md' })
$newHash = Get-ContentHash -Base $root -Entries $hashItems
$oldHash = ''
if (Test-Path $hashFile) { $oldHash = (Get-Content $hashFile -Raw).Trim() }
$changed = ($newHash -ne $oldHash)

# --- 0. версия: +1 только если содержимое изменилось с прошлой заливки ------
$versionFile = Join-Path $root 'version.json'
$changelogFile = Join-Path $root 'CHANGELOG.md'
$utf8 = New-Object Text.UTF8Encoding($false)
$info = [IO.File]::ReadAllText($versionFile, $utf8) | ConvertFrom-Json
$oldVersion = [string]$info.version
$version = $oldVersion

if (-not $NoBump -and -not $SkipUpload -and $changed) {
    $parts = @($oldVersion -split '\.')
    while ($parts.Count -lt 3) { $parts += '0' }
    $parts[2] = [string]([int]$parts[2] + 1)
    $version = $parts -join '.'
    $today = Get-Date -Format 'yyyy-MM-dd'

    $info.version = $version
    $info.date = $today
    $json = ($info | ConvertTo-Json) -replace "`r`n", "`n"
    [IO.File]::WriteAllText($versionFile, $json, $utf8)

    if (Test-Path $changelogFile) {
        $text = ([IO.File]::ReadAllText($changelogFile, $utf8)) -replace "`r`n", "`n"
        $entry = "## $version — $today`n`n- $Message`n`n"
        if ($text -match '(?m)^## ') {
            $text = ([regex]'(?m)^## ').Replace($text, ($entry + '## '), 1)
        } else {
            $text = $text.TrimEnd() + "`n`n" + $entry
        }
        [IO.File]::WriteAllText($changelogFile, $text, $utf8)
    }

    Write-Host "версия: $oldVersion -> $version"
} else {
    if (-not $SkipUpload -and -not $changed) {
        Write-Host "версия: $version (изменений нет — подъём не нужен)"
    } else {
        Write-Host "версия: $version (без подъёма)"
    }
}

foreach ($item in $items) {
    if (-not (Test-Path (Join-Path $root $item))) {
        throw "в проекте нет '$item' (запускайте скрипт из папки проекта)"
    }
}

$tar = Join-Path $env:TEMP ("mypult-$version-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".tar")

& tar --format=ustar --exclude '__pycache__' --exclude '*.pyc' -cf $tar -C $root @items
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tar)) {
    throw 'tar не смог собрать архив (нужен tar.exe из Windows 10+)'
}

Write-Host ("архив: {0} ({1:N0} байт)" -f $tar, (Get-Item $tar).Length)

if ($SkipUpload) {
    Write-Host 'SkipUpload: отправка пропущена'
    return
}

# --- 1. отправка: файл подаётся в stdin ssh через cmd ---------------------
$sshArgs = "-p $Port $User@$Station"

function Invoke-RemoteStream {
    param([string]$RemoteCommand, [string]$InputFile)

    # Красный редирект делаем в .cmd-файле: PowerShell при передаче строки
    # в cmd переэкранирует кавычки и ломает команду.
    $cmdFile = Join-Path $env:TEMP ("mypult-cmd-" + [guid]::NewGuid().ToString('N').Substring(0, 6) + ".cmd")
    $content = @(
        '@echo off',
        ('ssh {0} "{1}" < "{2}"' -f $sshArgs, $RemoteCommand, $InputFile),
        'exit /b %ERRORLEVEL%'
    )
    Set-Content -Path $cmdFile -Value $content -Encoding Default

    & cmd.exe /c $cmdFile | Out-Null
    $result = $LASTEXITCODE
    Remove-Item $cmdFile -ErrorAction SilentlyContinue
    return $result
}

$remoteUnpack = "mkdir -p $Target && tar -xf - -C $Target"
Write-Host "отправляю на ${User}@${Station}:$Target ..."

$code = Invoke-RemoteStream -RemoteCommand $remoteUnpack -InputFile $tar
$usePerFile = $false
if ($code -ne 0) {
    Write-Warn "ssh/tar вернул код $code — перехожу на пофайловую заливку"
    $usePerFile = $true
}

# --- 2. проверка, что распаковалось --------------------------------------
$localIndex = (Get-Item (Join-Path $root 'index.html')).Length

function Get-RemoteIndexSize {
    $value = & ssh -p $Port "$User@$Station" "wc -c < '$Target/index.html'" 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($value | Select-Object -First 1).Trim()
}

if (-not $usePerFile) {
    $remoteIndex = Get-RemoteIndexSize
    if ("$remoteIndex" -ne "$localIndex") {
        Write-Warn "index.html на колонке ($remoteIndex) не совпал с локальным ($localIndex)"
        $usePerFile = $true
    }
}

# --- 3. резервный путь: каждый файл через base64 --------------------------
if ($usePerFile) {
    $files = foreach ($item in $items) {
        $path = Join-Path $root $item
        if (Test-Path $path -PathType Leaf) {
            Get-Item $path
        } else {
            Get-ChildItem $path -Recurse -File |
                Where-Object { $_.Extension -ne '.pyc' -and $_.FullName -notmatch '__pycache__' }
        }
    }

    Write-Host ("пофайловая заливка: {0} файлов" -f @($files).Count)
    foreach ($file in $files) {
        $rel = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        $parts = $rel -split '/'
        $dir = if ($parts.Count -gt 1) { ($parts[0..($parts.Count - 2)] -join '/') } else { '' }
        $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))

        $remote = if ($dir) {
            "mkdir -p '$Target/$dir' && base64 -d > '$Target/$rel'"
        } else {
            "base64 -d > '$Target/$rel'"
        }

        $b64 | ssh -p $Port "$User@$Station" $remote
        if ($LASTEXITCODE -ne 0) { throw "не удалось залить $rel" }
        Write-Host ("  ok  {0}" -f $rel)
    }

    $remoteIndex = Get-RemoteIndexSize
    if ("$remoteIndex" -ne "$localIndex") {
        throw "после пофайловой заливки размер index.html всё ещё не совпадает ($remoteIndex / $localIndex)"
    }
}

Write-Host ("готово: index.html на колонке {0} байт" -f $localIndex)
try { Set-Content -Path $hashFile -Value $newHash -Encoding ascii } catch { }
Remove-Item $tar -ErrorAction SilentlyContinue

# --------------------------------------------------------------------------- #
#  Установка на колонке
# --------------------------------------------------------------------------- #

if ($NoInstall) {
    Write-Host ''
    Write-Host 'Установка пропущена (-NoInstall). Запустить вручную:'
    Write-Host ("  ssh -p {0} {1}@{2} `"sh {3}/deploy/install.sh`"" -f $Port, $User, $Station, $Target)
    return
}

Write-Step 'установка на колонке'
$installCmd = "sh $Target/deploy/install.sh"

& ssh -p $Port "$User@$Station" $installCmd
$installCode = $LASTEXITCODE

if ($installCode -eq 2) {
    Write-Warn 'на 8055 работает старый lighttpd — повторяю установку с FORCE_WEB=1'
    & ssh -p $Port "$User@$Station" "FORCE_WEB=1 $installCmd"
    $installCode = $LASTEXITCODE
}

if ($installCode -ne 0) {
    throw "install.sh завершился с кодом $installCode (см. вывод выше и /tmp/mypult.log)"
}

Write-Host ''
Write-Host ("Готово. Откройте http://{0}:8055/" -f $Station) -ForegroundColor Green
