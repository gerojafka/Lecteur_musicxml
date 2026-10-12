$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = $PSScriptRoot
$libraryPath = Join-Path $root 'library.json'
$library = Get-Content -LiteralPath $libraryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$items = @($library.sessions)
Write-Host 'Lecteur MusicXML v27 - Bibliotheque'
Write-Host '1. Ajouter un ou plusieurs morceaux'
Write-Host '2. Retirer un morceau de la liste'
Write-Host 'Entree : quitter'
$choice = Read-Host 'Votre choix'
if ($choice -eq '1') {
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Choisir un ou plusieurs MusicXML (Ctrl ou Maj pour plusieurs)'
    $picker.Filter = 'Partition|*.musicxml;*.xml;*.mxl;*.pdf;*.mid;*.midi|Tous les fichiers|*.*'
    $picker.Multiselect = $true
    if ($picker.ShowDialog() -ne 'OK') { exit }
    $folder = Join-Path $root 'partitions'
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $sources = @{}
    foreach ($selectedPath in $picker.FileNames) {
        $source = Get-Item -LiteralPath $selectedPath
        if ($source.Extension.ToLower() -notin @('.musicxml','.xml','.mxl')) {
            $match = @('.musicxml','.xml','.mxl') | ForEach-Object { Join-Path $source.DirectoryName ($source.BaseName + $_) } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
            if (-not $match) { Write-Host "Ignore : MusicXML homonyme introuvable pour $($source.Name)" -ForegroundColor Yellow; continue }
            $source = Get-Item -LiteralPath $match
        }
        $sources[$source.FullName] = $source
    }
    if ($sources.Count -eq 0) { throw 'Aucun MusicXML valide selectionne.' }
    $customTitle = ''
    if ($sources.Count -eq 1) { $customTitle = Read-Host "Titre affiche (Entree = $($sources.Values[0].BaseName))" }
    $added = 0
    foreach ($source in $sources.Values) {
        $title = if ($sources.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace($customTitle)) { $customTitle } else { $source.BaseName }
        $slug = ($source.BaseName.Normalize([Text.NormalizationForm]::FormD) -replace '\p{M}', '' -replace '[^a-zA-Z0-9_-]', '-').Trim('-').ToLower()
        if (-not $slug) { $slug = 'partition-' + [DateTime]::Now.ToString('yyyyMMddHHmmss') }
        # Do not overwrite an earlier score with the same basename.
        $baseSlug = $slug; $counter = 2
        while ($items.id -contains $slug) { $slug = "$baseSlug-$counter"; $counter++ }
        $filename = $slug + $source.Extension.ToLower()
        $destination = Join-Path $folder $filename
        if (Test-Path -LiteralPath $destination) { $filename = $slug + '-' + [DateTime]::Now.ToString('yyyyMMddHHmmss') + $source.Extension.ToLower(); $destination = Join-Path $folder $filename }
        Copy-Item -LiteralPath $source.FullName -Destination $destination
        $items += [pscustomobject]@{id=$slug;name=$title;xml_url="./partitions/$filename"}
        $added++
        Write-Host "Ajoute : $title"
    }
    Write-Host "$added morceau(x) ajoute(s)." -ForegroundColor Green
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
$worker = $worker -replace "const VERSION='[^']+';", ("const VERSION='v27-" + [DateTime]::Now.ToString('yyyyMMddHHmmss') + "';")
[IO.File]::WriteAllText($workerPath, $worker, $utf8)
Write-Host 'Bibliotheque mise a jour. Envoyez le dossier complet sur GitHub Pages.'
Read-Host 'Entree pour fermer'
