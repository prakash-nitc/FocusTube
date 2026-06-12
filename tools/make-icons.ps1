# FocusTube icon generator.
# Draws the extension logo (gradient tile + focus ring + play triangle)
# with System.Drawing and writes transparent PNGs at all manifest sizes.
# Run:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\assets\icons'
$outDir = (Resolve-Path $outDir).Path

function New-FocusTubeIcon {
    param([int]$Size, [string]$OutFile, [bool]$Ring)

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = [single]$Size

    # Rounded-square background
    $r = [single]($s * 0.22)
    $d = $r * 2
    $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
    $bg.AddArc(0, 0, $d, $d, 180, 90)
    $bg.AddArc($s - $d, 0, $d, $d, 270, 90)
    $bg.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
    $bg.AddArc(0, $s - $d, $d, $d, 90, 90)
    $bg.CloseFigure()

    # Brand gradient: #6C3CE1 (purple) -> #00B4D8 (cyan), top-left to bottom-right
    $c1 = [System.Drawing.Color]::FromArgb(255, 108, 60, 225)
    $c2 = [System.Drawing.Color]::FromArgb(255, 0, 180, 216)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, ([single]45)
    $g.FillPath($grad, $bg)

    if ($Ring) {
        # Focus ring
        $penW = [single][Math]::Max(1.0, $s * 0.06)
        $ringColor = [System.Drawing.Color]::FromArgb(215, 255, 255, 255)
        $pen = New-Object System.Drawing.Pen $ringColor, $penW
        $m = [single]($s * 0.185)
        $g.DrawEllipse($pen, $m, $m, $s - 2 * $m, $s - 2 * $m)
        $pen.Dispose()

        # Play triangle, optically centered inside the ring
        $pts = @(
            (New-Object System.Drawing.PointF ([single]($s * 0.41)), ([single]($s * 0.345))),
            (New-Object System.Drawing.PointF ([single]($s * 0.41)), ([single]($s * 0.655))),
            (New-Object System.Drawing.PointF ([single]($s * 0.70)), ([single]($s * 0.50)))
        )
    }
    else {
        # Tiny sizes: drop the ring, enlarge the triangle for legibility
        $pts = @(
            (New-Object System.Drawing.PointF ([single]($s * 0.34)), ([single]($s * 0.25))),
            (New-Object System.Drawing.PointF ([single]($s * 0.34)), ([single]($s * 0.75))),
            (New-Object System.Drawing.PointF ([single]($s * 0.80)), ([single]($s * 0.50)))
        )
    }

    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillPolygon($white, $pts)

    $white.Dispose()
    $grad.Dispose()
    $bg.Dispose()
    $g.Dispose()

    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Wrote $OutFile ($Size x $Size)"
}

New-FocusTubeIcon -Size 16  -OutFile (Join-Path $outDir 'icon-16.png')  -Ring $false
New-FocusTubeIcon -Size 32  -OutFile (Join-Path $outDir 'icon-32.png')  -Ring $true
New-FocusTubeIcon -Size 48  -OutFile (Join-Path $outDir 'icon-48.png')  -Ring $true
New-FocusTubeIcon -Size 128 -OutFile (Join-Path $outDir 'icon-128.png') -Ring $true
