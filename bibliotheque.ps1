$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = $PSScriptRoot
$libraryPath = Join-Path $root 'library.json'
$library = Get-Content -LiteralPath $libraryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$items = @($library.sessions)
Write-Host 'Lecteur MusicXML v26 - Bibliotheque'
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
$worker = $worker -replace "const VERSION='[^']+';", ("const VERSION='v26-" + [DateTime]::Now.ToString('yyyyMMddHHmmss') + "';")
[IO.File]::WriteAllText($workerPath, $worker, $utf8)
Write-Host 'Bibliotheque mise a jour. Envoyez le dossier complet sur GitHub Pages.'
Read-Host 'Entree pour fermer'
