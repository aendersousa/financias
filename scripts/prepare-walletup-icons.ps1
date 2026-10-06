param(
    [string]$SourceDirectory = (Join-Path $env:USERPROFILE 'Downloads'),
    [switch]$AndroidOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$publicDirectory = Join-Path $projectRoot 'src/renderer/public'
$brandDirectory = Join-Path $publicDirectory 'brand'
$resourceDirectory = Join-Path $projectRoot 'resources'
if (-not $AndroidOnly) {
    New-Item -ItemType Directory -Path $brandDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $resourceDirectory -Force | Out-Null
}

# Keep supplied artwork intact. Only app icon renditions are resized below.
$sources = @{
    'app-icon.png' = 'Ícone de Carteira Financeira Verde.png'
    'wallet-mark.png' = 'Ícone de Carteira com Crescimento.png'
    'walletup-logo.png' = 'Logo WalletUp com Ícone de Carteira e Gráfico Verde.png'
}
if (-not $AndroidOnly) {
    foreach ($destinationName in $sources.Keys) {
        $sourcePath = Join-Path $SourceDirectory $sources[$destinationName]
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $brandDirectory $destinationName) -Force
    }
}

function New-IconBitmap {
    param([System.Drawing.Image]$Source, [int]$Size)

    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $scale = [Math]::Min($Size / $Source.Width, $Size / $Source.Height)
        $width = [int][Math]::Round($Source.Width * $scale)
        $height = [int][Math]::Round($Source.Height * $scale)
        $rectangle = [System.Drawing.Rectangle]::new([int](($Size - $width) / 2), [int](($Size - $height) / 2), $width, $height)
        $imageAttributes = [System.Drawing.Imaging.ImageAttributes]::new()
        try {
            $imageAttributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
            $graphics.DrawImage($Source, $rectangle, 0, 0, $Source.Width, $Source.Height, [System.Drawing.GraphicsUnit]::Pixel, $imageAttributes)
        }
        finally { $imageAttributes.Dispose() }
    }
    finally { $graphics.Dispose() }
    return $bitmap
}

$appIcon = [System.Drawing.Image]::FromFile((Join-Path $brandDirectory 'app-icon.png'))
try {
    if (-not $AndroidOnly) {
        $pngSizes = @{
            'icon-192.png' = 192
            'icon-512.png' = 512
            'apple-touch-icon.png' = 180
            'favicon-32.png' = 32
        }
        foreach ($destinationName in $pngSizes.Keys) {
            $bitmap = New-IconBitmap -Source $appIcon -Size $pngSizes[$destinationName]
            try { $bitmap.Save((Join-Path $publicDirectory $destinationName), [System.Drawing.Imaging.ImageFormat]::Png) }
            finally { $bitmap.Dispose() }
        }
    
        # ICO stores faithful PNG renditions at desktop sizes (supported by modern Windows).
        $icoSizes = @(32, 48, 256)
        $icoImages = @()
        foreach ($size in $icoSizes) {
            $bitmap = New-IconBitmap -Source $appIcon -Size $size
            $stream = [System.IO.MemoryStream]::new()
            try {
                $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
                $icoImages += ,($stream.ToArray())
            }
            finally { $stream.Dispose(); $bitmap.Dispose() }
        }
    
        $icoStream = [System.IO.File]::Create((Join-Path $resourceDirectory 'walletup.ico'))
        $writer = [System.IO.BinaryWriter]::new($icoStream)
        try {
            $writer.Write([uint16]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]$icoSizes.Count)
            $offset = 6 + (16 * $icoSizes.Count)
            for ($index = 0; $index -lt $icoSizes.Count; $index++) {
                $encodedSize = if ($icoSizes[$index] -eq 256) { 0 } else { $icoSizes[$index] }
                $writer.Write([byte]$encodedSize)
                $writer.Write([byte]$encodedSize)
                $writer.Write([byte]0)
                $writer.Write([byte]0)
                $writer.Write([uint16]1)
                $writer.Write([uint16]32)
                $writer.Write([uint32]$icoImages[$index].Length)
                $writer.Write([uint32]$offset)
                $offset += $icoImages[$index].Length
            }
            foreach ($imageBytes in $icoImages) { $writer.Write([byte[]]$imageBytes) }
        }
        finally { $writer.Dispose(); $icoStream.Dispose() }
    }

    # Preserve supplied artwork and existing Android launcher resource names.
    $androidResources = Join-Path $projectRoot 'android/app/src/main/res'
    $androidDensities = @(
        @{ Directory = 'mipmap-mdpi'; LauncherSize = 48; ForegroundSize = 108 },
        @{ Directory = 'mipmap-hdpi'; LauncherSize = 72; ForegroundSize = 162 },
        @{ Directory = 'mipmap-xhdpi'; LauncherSize = 96; ForegroundSize = 216 },
        @{ Directory = 'mipmap-xxhdpi'; LauncherSize = 144; ForegroundSize = 324 },
        @{ Directory = 'mipmap-xxxhdpi'; LauncherSize = 192; ForegroundSize = 432 }
    )
    foreach ($density in $androidDensities) {
        $densityDirectory = Join-Path $androidResources $density.Directory
        if (-not (Test-Path -LiteralPath $densityDirectory -PathType Container)) {
            throw "Missing existing Android density directory: $densityDirectory"
        }
        $launcherBitmap = New-IconBitmap -Source $appIcon -Size $density.LauncherSize
        try {
            $launcherBitmap.Save((Join-Path $densityDirectory 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
            $launcherBitmap.Save((Join-Path $densityDirectory 'ic_launcher_round.png'), [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $launcherBitmap.Dispose() }
        $foregroundBitmap = New-IconBitmap -Source $appIcon -Size $density.ForegroundSize
        try { $foregroundBitmap.Save((Join-Path $densityDirectory 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
        finally { $foregroundBitmap.Dispose() }
    }
}
finally { $appIcon.Dispose() }

if ($AndroidOnly) {
    Write-Output 'WalletUp Android launcher PNG renditions generated from the supplied app icon.'
}
else {
    Write-Output 'WalletUp sources copied unchanged; web, Windows ICO and Android launcher renditions generated.'
}
