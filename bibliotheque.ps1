[CmdletBinding()]
param(
    [ValidateSet('open-library','choose-source','add-batch','add-guided','remove-batch')]
    [string]$Action
)

if ($PSBoundParameters.ContainsKey('Action')) {
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $appRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
    $appLibraryPath = Join-Path $appRoot 'library.json'
    $appPartitionsPath = Join-Path $appRoot 'partitions'
    $sourceConfigPath = Join-Path $appRoot '.partitions-source.txt'
    New-Item -ItemType Directory -Force -Path $appPartitionsPath | Out-Null

    function Read-AppLibrary {
        $data = Get-Content -LiteralPath $appLibraryPath -Raw -Encoding UTF8 | ConvertFrom-Json
        return @($data.sessions)
    }

    function Update-AppServiceWorker {
        $workerPath = Join-Path $appRoot 'service-worker.js'
        if (-not (Test-Path -LiteralPath $workerPath)) { return }
        $utf8 = New-Object Text.UTF8Encoding($false)
        $worker = Get-Content -LiteralPath $workerPath -Raw -Encoding UTF8
        $worker = $worker -replace "const VERSION='[^']+';", ("const VERSION='v28-" + [DateTime]::Now.ToString('yyyyMMddHHmmss') + "';")
        [IO.File]::WriteAllText($workerPath, $worker, $utf8)
    }

    function Save-AppLibrary([object[]]$scores) {
        $utf8 = New-Object Text.UTF8Encoding($false)
        $json = @{ sessions = @($scores) } | ConvertTo-Json -Depth 6
        [IO.File]::WriteAllText($appLibraryPath, $json, $utf8)
        Update-AppServiceWorker
    }

    function Get-SourceFolder {
        if (Test-Path -LiteralPath $sourceConfigPath) {
            $saved = (Get-Content -LiteralPath $sourceConfigPath -Raw).Trim()
            if ($saved -and (Test-Path -LiteralPath $saved -PathType Container)) {
                return (Resolve-Path -LiteralPath $saved).Path
            }
        }
        return $null
    }

    function New-ScoreSlug([string]$value) {
        $normalized = $value.Normalize([Text.NormalizationForm]::FormD) -replace '\p{M}', ''
        $slug = ($normalized -replace '[^a-zA-Z0-9]+', '-').Trim('-').ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($slug)) { return 'partition' }
        return $slug
    }

    function Get-UniqueScoreId([string]$baseId, [object[]]$scores) {
        $id = $baseId
        $number = 2
        while (@($scores | Where-Object { $_.id -eq $id }).Count) {
            $id = "$baseId-$number"
            $number++
        }
        return $id
    }

    function Select-ScoreFiles([bool]$multiple, [string]$title) {
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = $title
        $dialog.Filter = 'Partitions MusicXML (*.musicxml;*.xml;*.mxl)|*.musicxml;*.xml;*.mxl|Tous les fichiers (*.*)|*.*'
        $dialog.Multiselect = $multiple
        $dialog.CheckFileExists = $true
        $dialog.RestoreDirectory = $true
        $initialFolder = Get-SourceFolder
        if ($initialFolder) { $dialog.InitialDirectory = $initialFolder }
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return @() }
        return @($dialog.FileNames)
    }

    function Add-AppScore([string]$sourcePath, [object[]]$scores, [string]$title = $null) {
        $source = Get-Item -LiteralPath $sourcePath
        $extension = $source.Extension.ToLowerInvariant()
        if ($extension -notin '.musicxml', '.xml', '.mxl') { throw "Format non pris en charge : $($source.Name)" }
        $displayTitle = if ([string]::IsNullOrWhiteSpace($title)) { $source.BaseName } else { $title.Trim() }
        $baseId = New-ScoreSlug $displayTitle
        $id = $baseId
        $fileName = "$id$extension"
        $number = 2
        while (@($scores | Where-Object { $_.id -eq $id }).Count -or (Test-Path -LiteralPath (Join-Path $appPartitionsPath $fileName))) {
            $id = "$baseId-$number"
            $fileName = "$id$extension"
            $number++
        }
        Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $appPartitionsPath $fileName)
        return [pscustomobject]@{ id = $id; name = $displayTitle; xml_url = "./partitions/$fileName" }
    }

    function Select-ScoresToRemove([object[]]$scores) {
        if (-not $scores.Count) { return @() }
        $form = New-Object System.Windows.Forms.Form
        $form.Text = 'Choisir les partitions a enlever'
        $form.StartPosition = 'CenterScreen'
        $form.Size = New-Object System.Drawing.Size(720, 560)
        $form.MinimumSize = New-Object System.Drawing.Size(560, 420)

        $label = New-Object System.Windows.Forms.Label
        $label.Text = "Cochez les partitions a retirer de la bibliotheque :" + [Environment]::NewLine + $appPartitionsPath
        $label.Dock = 'Top'
        $label.Height = 48
        $label.Padding = New-Object System.Windows.Forms.Padding(12, 10, 12, 4)
        $form.Controls.Add($label)

        $list = New-Object System.Windows.Forms.CheckedListBox
        $list.Dock = 'Fill'
        $list.CheckOnClick = $true
        $list.IntegralHeight = $false
        $list.Font = New-Object System.Drawing.Font('Segoe UI', 10)
        foreach ($score in $scores) { [void]$list.Items.Add("$($score.name)  [$($score.id)]") }
        $form.Controls.Add($list)

        $buttons = New-Object System.Windows.Forms.FlowLayoutPanel
        $buttons.Dock = 'Bottom'
        $buttons.Height = 52
        $buttons.FlowDirection = 'RightToLeft'
        $buttons.Padding = New-Object System.Windows.Forms.Padding(8)
        $ok = New-Object System.Windows.Forms.Button
        $ok.Text = 'Enlever les selectionnees'
        $ok.Width = 180
        $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $cancel = New-Object System.Windows.Forms.Button
        $cancel.Text = 'Annuler'
        $cancel.Width = 90
        $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
        $buttons.Controls.Add($ok)
        $buttons.Controls.Add($cancel)
        $form.Controls.Add($buttons)
        $form.AcceptButton = $ok
        $form.CancelButton = $cancel

        if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return @() }
        return @($list.CheckedIndices | ForEach-Object { $scores[$_] })
    }

    function Remove-AppScoreFile($score) {
        $relative = ([string]$score.xml_url) -replace '^\./', ''
        $filePath = [IO.Path]::GetFullPath((Join-Path $appRoot $relative))
        $safeRoot = [IO.Path]::GetFullPath($appPartitionsPath).TrimEnd('\') + '\'
        if ($filePath.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $filePath)) {
            Remove-Item -LiteralPath $filePath -Force
        }
    }

    $scores = @(Read-AppLibrary)
    switch ($Action) {
        'open-library' {
            Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f $appPartitionsPath)
            Write-Output "Dossier ouvert : $appPartitionsPath"
        }
        'choose-source' {
            $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
            $dialog.Description = 'Choisir le dossier ouvert par defaut pour ajouter des partitions'
            $dialog.ShowNewFolderButton = $false
            $current = Get-SourceFolder
            if ($current) { $dialog.SelectedPath = $current }
            if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Output 'Annule.'; break }
            $chosen = (Resolve-Path -LiteralPath $dialog.SelectedPath).Path
            Set-Content -LiteralPath $sourceConfigPath -Value $chosen -Encoding utf8
            Write-Output "Dossier memorise : $chosen"
        }
        'add-batch' {
            $files = @(Select-ScoreFiles $true 'Choisir une ou plusieurs partitions MusicXML')
            if (-not $files.Count) { Write-Output 'Aucun fichier selectionne.'; break }
            $added = 0
            foreach ($file in $files) {
                try {
                    $scores += Add-AppScore $file $scores
                    $added++
                    Write-Output "Ajoute : $([IO.Path]::GetFileName($file))"
                } catch { Write-Warning "Impossible d'ajouter $file : $($_.Exception.Message)" }
            }
            if ($added) { Save-AppLibrary $scores }
            Write-Output "$added partition(s) ajoutee(s)."
        }
        'add-guided' {
            $files = @(Select-ScoreFiles $false 'Choisir une partition MusicXML')
            if (-not $files.Count) { Write-Output 'Aucun fichier selectionne.'; break }
            $source = Get-Item -LiteralPath $files[0]
            $title = Read-Host "Titre affiche (Entree = $($source.BaseName))"
            $scores += Add-AppScore $source.FullName $scores $title
            Save-AppLibrary $scores
            Write-Output "Ajoute : $($scores[-1].name)"
        }
        'remove-batch' {
            $selected = @(Select-ScoresToRemove $scores)
            if (-not $selected.Count) { Write-Output 'Aucune partition selectionnee.'; break }
            foreach ($score in $selected) { Remove-AppScoreFile $score }
            $selectedIds = @($selected | ForEach-Object { $_.id })
            $scores = @($scores | Where-Object { $_.id -notin $selectedIds })
            Save-AppLibrary $scores
            Write-Output ("Partition(s) enlevee(s) : " + ($selected.name -join ', '))
        }
    }
    exit
}

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = $PSScriptRoot
$libraryPath = Join-Path $root 'library.json'
$library = Get-Content -LiteralPath $libraryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$items = @($library.sessions)
Write-Host 'Lecteur MusicXML v28 - Bibliotheque'
Write-Host '1. Ajouter un morceau'
Write-Host '2. Retirer un morceau de la liste'
Write-Host 'Entree : quitter'
$choice = Read-Host 'Votre choix'
if ($choice -eq '1') {
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Choisir le MusicXML (ou un fichier du meme morceau)'
    $picker.Filter = 'Partition|*.musicxml;*.xml;*.mxl;*.pdf;*.mid;*.midi|Tous les fichiers|*.*'
    if ($picker.ShowDialog() -ne 'OK') { exit }
    $source = Get-Item -LiteralPath $picker.FileName
    if ($source.Extension.ToLower() -notin @('.musicxml','.xml','.mxl')) {
        $match = @('.musicxml','.xml','.mxl') | ForEach-Object { Join-Path $source.DirectoryName ($source.BaseName + $_) } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $match) { throw 'MusicXML de meme nom introuvable dans ce dossier.' }
        $source = Get-Item -LiteralPath $match
    }
    $title = Read-Host "Titre affiche (Entree = $($source.BaseName))"
    if ([string]::IsNullOrWhiteSpace($title)) { $title = $source.BaseName }
    $slug = ($source.BaseName.Normalize([Text.NormalizationForm]::FormD) -replace '\p{M}', '' -replace '[^a-zA-Z0-9_-]', '-').Trim('-').ToLower()
    if (-not $slug) { $slug = 'partition-' + [DateTime]::Now.ToString('yyyyMMddHHmmss') }
    # Do not overwrite an earlier score with the same basename.
    $baseSlug = $slug; $counter = 2
    while ($items.id -contains $slug) { $slug = "$baseSlug-$counter"; $counter++ }
    $folder = Join-Path $root 'partitions'
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $filename = $slug + $source.Extension.ToLower()
    $destination = Join-Path $folder $filename
    if (Test-Path -LiteralPath $destination) { $filename = $slug + '-' + [DateTime]::Now.ToString('yyyyMMddHHmmss') + $source.Extension.ToLower(); $destination = Join-Path $folder $filename }
    Copy-Item -LiteralPath $source.FullName -Destination $destination
    $items += [pscustomobject]@{id=$slug;name=$title;xml_url="./partitions/$filename"}
} elseif ($choice -eq '2') {
    for ($i=0; $i -lt $items.Count; $i++) { Write-Host "$($i+1). $($items[$i].name)" }
    $raw = Read-Host 'Numero a retirer (Entree = annuler)'
    if ([string]::IsNullOrWhiteSpace($raw)) { exit }
    $index = 0
    if (-not [int]::TryParse($raw, [ref]$index) -or $index -lt 1 -or $index -gt $items.Count) { throw 'Numero invalide.' }
    $items = @($items | Where-Object id -NE $items[$index-1].id)
    Write-Host 'Le fichier est conserve dans partitions ; seul le morceau est retire de la liste.'
} else { exit }
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($libraryPath, (@{sessions=@($items)} | ConvertTo-Json -Depth 6), $utf8)
$workerPath = Join-Path $root 'service-worker.js'
$worker = Get-Content -LiteralPath $workerPath -Raw -Encoding UTF8
$worker = $worker -replace "const VERSION='[^']+';", ("const VERSION='v28-" + [DateTime]::Now.ToString('yyyyMMddHHmmss') + "';")
[IO.File]::WriteAllText($workerPath, $worker, $utf8)
Write-Host 'Bibliotheque mise a jour. Envoyez le dossier complet sur GitHub Pages.'
Read-Host 'Entree pour fermer'
