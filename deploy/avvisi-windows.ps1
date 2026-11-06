# Avvisi di Vigil nel centro notifiche di Windows.
# Gira in background per l'utente collegato e chiede al sito se ci sono avvisi nuovi.
# Il comando di installazione si copia dalla pagina "Il mio account" della dashboard.
# Questo file resta in solo ASCII: PowerShell 5.1 legge i .ps1 senza BOM con la codifica locale.
param(
  [switch]$Installa,
  [switch]$Disinstalla,
  [switch]$Prova,
  [string]$Token,
  [string]$Sito = 'https://dashboard.example.com'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppId = 'Vigil.Monitoraggio'
$TaskName = 'Vigil - avvisi'
$Folder = Join-Path $env:LOCALAPPDATA 'Vigil'
$ScriptPath = Join-Path $Folder 'avvisi.ps1'
$TokenPath = Join-Path $Folder 'token.dat'
$StatePath = Join-Path $Folder 'stato.json'
$LogPath = Join-Path $Folder 'avvisi.log'
$IconPath = Join-Path $Folder 'icona.png'
$AppKey = "HKCU:\Software\Classes\AppUserModelId\$AppId"

$PollSeconds = 15
# Letture fallite di fila prima di dire che il sito non risponde: circa un minuto
$FailuresBeforeNotice = 4
# Con piu' avvisi insieme, per esempio per uno switch caduto, ne arriva uno solo
$GroupAbove = 3

function Write-Log([string]$Text) {
  try {
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 200KB) { Remove-Item $LogPath }
    Add-Content -Path $LogPath -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Text)
  } catch {
    # Il registro non deve mai fermare gli avvisi
  }
}

function Show-Toast([string]$Title, [string]$Body, [string]$Link, [double]$When = 0) {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]

  $escape = [System.Security.SecurityElement]
  $attributes = 'activationType="protocol" launch="{0}"' -f $escape::Escape($Link)
  if ($When -gt 0) {
    $stamp = [DateTimeOffset]::FromUnixTimeSeconds([long]$When).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $attributes += ' displayTimestamp="{0}"' -f $stamp
  }
  $lines = '<text>{0}</text>' -f $escape::Escape($Title)
  if ($Body) { $lines += '<text>{0}</text>' -f $escape::Escape($Body) }

  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml("<toast $attributes><visual><binding template=`"ToastGeneric`">$lines</binding></visual></toast>")
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)
}

function Read-Token {
  $secure = Get-Content $TokenPath | ConvertTo-SecureString
  (New-Object System.Net.NetworkCredential('', $secure)).Password
}

function Read-State {
  $empty = [pscustomobject]@{ after = $null; failures = 0; unreachable = $false; pingerDown = 0; pingerNoticed = $false; revoked = $false }
  if (-not (Test-Path $StatePath)) { return $empty }
  try {
    $saved = Get-Content $StatePath -Raw | ConvertFrom-Json
    foreach ($name in $empty.PSObject.Properties.Name) {
      if ($null -ne $saved.$name) { $empty.$name = $saved.$name }
    }
  } catch {
    Write-Log "Stato non leggibile: riparto da zero"
  }
  $empty
}

function Save-State($State) {
  $State | ConvertTo-Json | Set-Content -Path $StatePath -Encoding ASCII
}

function Get-Feed($After, [string]$Secret) {
  $uri = "$Sito/api/avvisi"
  if ($null -ne $After) { $uri += "?dopo=$After" }
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10 -Headers @{ Authorization = "Bearer $Secret" }
  # Decodifica esplicita: senza, PowerShell 5.1 rovina le lettere accentate
  [Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray()) | ConvertFrom-Json
}

function Show-Alerts($Feed) {
  $alerts = @($Feed.alerts)
  if ($alerts.Count -eq 0) { return }

  if ($alerts.Count -gt $GroupAbove -or $Feed.more) {
    $title = if ($Feed.more) { 'Oltre 50 nuovi avvisi' } else { "$($alerts.Count) nuovi avvisi" }
    $body = ($alerts | Select-Object -Last 3 | ForEach-Object { $_.title }) -join "`n"
    Show-Toast $title $body "$Sito/eventi"
    return
  }

  foreach ($alert in $alerts) {
    $link = if ($alert.hostId) { "$Sito/host/$($alert.hostId)" } else { "$Sito/admin/server" }
    Show-Toast $alert.title $alert.body $link $alert.ts
  }
}

function Update-Pinger($State, $Pinger) {
  if ($Pinger.healthy) {
    $State.pingerDown = 0
    if ($State.pingerNoticed) {
      $State.pingerNoticed = $false
      Show-Toast 'Servizio di ping ripartito' 'Gli stati sono di nuovo aggiornati.' $Sito
    }
    return
  }
  $State.pingerDown++
  if ($State.pingerDown -ge 2 -and -not $State.pingerNoticed) {
    $State.pingerNoticed = $true
    Show-Toast 'Servizio di ping fermo' 'Gli avvisi sugli host restano sospesi fino alla ripartenza.' $Sito
  }
}

# Restituisce $false quando non ha senso continuare
function Invoke-Poll($State, [string]$Secret) {
  try {
    $feed = Get-Feed $State.after $Secret
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 401) {
      if (-not $State.revoked) {
        $State.revoked = $true
        Show-Toast 'Avvisi scollegati' 'Questo PC ha smesso di ricevere gli avvisi. Puoi ricollegarlo da Il mio account.' "$Sito/account"
      }
      return $false
    }
    $State.failures++
    Write-Log "Lettura fallita ($($State.failures)): $($_.Exception.Message)"
    if ($State.failures -ge $FailuresBeforeNotice -and -not $State.unreachable) {
      $State.unreachable = $true
      Show-Toast 'Vigil non raggiungibile' 'Gli avvisi restano sospesi fino al ripristino.' $Sito
    }
    return $true
  }

  $State.failures = 0
  $State.revoked = $false
  if ($State.unreachable) {
    $State.unreachable = $false
    Show-Toast 'Vigil di nuovo raggiungibile' 'Gli avvisi sono ripartiti.' $Sito
  }

  if ($null -ne $State.after) { Show-Alerts $feed }
  Update-Pinger $State $feed.pinger

  $last = @($feed.alerts) | Select-Object -Last 1
  $State.after = if ($last -and $last.id -gt $feed.latest) { $last.id } else { $feed.latest }
  $true
}

function Start-Watching {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\VigilAvvisi')
  try {
    if (-not $mutex.WaitOne(0)) { return }
  } catch [System.Threading.AbandonedMutexException] {
    # L'agente precedente e' stato chiuso di forza: il blocco ora e' nostro
  }

  $secret = Read-Token
  $state = Read-State
  Write-Log "Avviato, avvisi da $($state.after)"
  while ($true) {
    $goOn = $true
    try {
      $goOn = Invoke-Poll $state $secret
      Save-State $state
    } catch {
      Write-Log "Errore: $($_.Exception.Message)"
    }
    if (-not $goOn) { return }
    Start-Sleep -Seconds $PollSeconds
  }
}

function New-Icon {
  Add-Type -AssemblyName System.Drawing
  $bitmap = New-Object System.Drawing.Bitmap 128, 128
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = 'AntiAlias'
  $graphics.TextRenderingHint = 'AntiAlias'
  $area = New-Object System.Drawing.Rectangle 0, 0, 128, 128
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#2f6fd6'))
  $graphics.FillRectangle($brush, $area)
  $font = New-Object System.Drawing.Font 'Segoe UI', 54, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = 'Center'
  $format.LineAlignment = 'Center'
  $graphics.DrawString('IT', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, 128, 128), $format)
  $bitmap.Save($IconPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Stop-Running {
  $running = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ScriptPath) -and $_.ProcessId -ne $PID }
  foreach ($process in $running) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Install-Avvisi {
  if (-not $Token) { throw 'Manca il token: copia il comando dalla pagina Il mio account.' }

  Stop-Running
  New-Item -ItemType Directory -Force -Path $Folder | Out-Null
  if ($PSCommandPath -and $PSCommandPath -ne $ScriptPath) {
    Copy-Item $PSCommandPath $ScriptPath -Force
  } elseif (-not $PSCommandPath) {
    Invoke-WebRequest -Uri "$Sito/avvisi-windows.ps1" -UseBasicParsing -OutFile $ScriptPath
  }

  # Cifrato con le credenziali di Windows: lo legge solo questo utente su questo PC
  ConvertTo-SecureString $Token -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $TokenPath
  if (Test-Path $StatePath) { Remove-Item $StatePath }

  New-Icon
  New-Item -Path $AppKey -Force | Out-Null
  New-ItemProperty -Path $AppKey -Name 'DisplayName' -Value 'Vigil' -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $AppKey -Name 'IconUri' -Value $IconPath -PropertyType String -Force | Out-Null

  # Il trigger ogni minuto rilancia l'agente se si ferma; se sta girando viene ignorato
  $arguments = "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`" -Sito `"$Sito`""
  $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  Show-Toast 'Avvisi attivi' 'Da ora i problemi della rete arrivano qui.' $Sito
  Write-Output 'Avvisi installati su questo PC.'
}

function Uninstall-Avvisi {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Stop-Running
  if (Test-Path $AppKey) { Remove-Item $AppKey -Recurse -Force }
  if (Test-Path $Folder) { Remove-Item $Folder -Recurse -Force }
  Write-Output 'Avvisi rimossi da questo PC.'
}

if ($Installa) { Install-Avvisi }
elseif ($Disinstalla) { Uninstall-Avvisi }
elseif ($Prova) { Show-Toast 'Prova degli avvisi' 'Se leggi questo messaggio, le notifiche funzionano.' $Sito }
else { Start-Watching }
