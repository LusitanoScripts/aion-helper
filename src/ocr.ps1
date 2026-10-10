# ── Aion Helper · o lado do Windows: OCR e o olho que vigia os cartões ───────
#
# Arranca uma vez e fica à espera de ordens na entrada padrão: acordar o motor
# de OCR e compilar o C# de baixo custa ~1 s, e pagar isso a cada leitura não dava.
#
# O motor de OCR é o do próprio Windows (Windows.Media.Ocr): já cá está, não vai
# à rede, e leu bem os nomes dos cartões do Aion (ecrã de 1600×1099 em ~0,3 s).
#
# **Não toca no jogo.** Copia píxeis do ambiente de trabalho, como qualquer
# programa de capturas; por isso só vê o jogo em janela sem bordas.
#
# Protocolo, uma linha por ordem e uma por resposta:
#   OCR <caminho.png>     ->  OK [{x1,y1,x2,y2,t}, ...]
#   VER                   ->  OK {"jogo":bool, "janela":[x,y,w,h], "rodapes":[{esquerda,direita,topo,fundo}]}
#                             (coordenadas do ecrã; só procura se o AION2 estiver à frente)
#   LER <x> <y> <w> <h>   ->  OK [{x1,y1,x2,y2,t}, ...] em coordenadas do ecrã
#   PING                  ->  OK pronto
#   SAIR                  ->  (fecha)
# Erro: ERR <mensagem>

param([string]$Idioma = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Runtime.WindowsRuntime

  # O olho vai em C# compilado: varrer 2560×1440 píxeis em PowerShell levava
  # segundos; em C# são milissegundos, e corre 4 vezes por segundo.
  $cs = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public class Olho {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }

  // O jogo à frente: devolve o retângulo da janela, ou null.
  public static int[] JanelaDoJogo(string processo) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return null;
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    try {
      if (processo != "*" && !string.Equals(Process.GetProcessById((int)pid).ProcessName, processo, StringComparison.OrdinalIgnoreCase)) return null;
    } catch { return null; }
    RECT r;
    if (!GetWindowRect(h, out r)) return null;
    return new int[] { r.L, r.T, r.R - r.L, r.B - r.T };
  }

  public static Bitmap Copiar(int x, int y, int w, int h) {
    Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(b))
      g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
    return b;
  }

  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr d, int dx, int dy, int dw, int dh, IntPtr s, int sx, int sy, int sw, int sh, int rop);
  [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc, int modo);

  // Cópia do ecrã já reduzida a metade, píxel sim píxel não (COLORONCOLOR: sem
  // misturar cores — a cor exata do rodapé tem de sobreviver). Medido: copiar
  // 2560×1440 inteiro era a maior parte dos ~60–90 ms de cada vigia.
  public static Bitmap CopiarReduzido(int x, int y, int w, int h, int f) {
    Bitmap b = new Bitmap(w / f, h / f, PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(b)) {
      IntPtr d = g.GetHdc();
      IntPtr ecra = GetDC(IntPtr.Zero);
      try {
        SetStretchBltMode(d, 3);
        StretchBlt(d, 0, 0, w / f, h / f, ecra, x, y, w, h, 0x00CC0020);
      } finally {
        ReleaseDC(IntPtr.Zero, ecra);
        g.ReleaseHdc(d);
      }
    }
    return b;
  }

  // Rodapés de cartão: faixas de 300+ px da cor (24,27,34), com 40+ linhas de
  // altura e 12+ limpas; o texto e os ícones do rodapé abrem buracos de até 30
  // linhas. É a mesma regra do src/cartoes.js (encontrarRodapes), aqui sobre a
  // cópia reduzida a metade — por isso os limiares vão a metade e o resultado ×2.
  public static string Rodapes(int x0, int y0, int w, int h) {
    using (Bitmap b = CopiarReduzido(x0, y0, w, h, 2)) return RodapesReduzido(b, x0, y0);
  }

  // Para os testes: a mesma deteção sobre um PNG, reduzido da mesma maneira
  // (vizinho mais próximo, píxel sim píxel não).
  public static string RodapesDeFicheiro(string caminho) {
    using (Bitmap o = new Bitmap(caminho))
    using (Bitmap b = new Bitmap(o.Width / 2, o.Height / 2, PixelFormat.Format32bppArgb)) {
      for (int y = 0; y < b.Height; y++)
        for (int x = 0; x < b.Width; x++) b.SetPixel(x, y, o.GetPixel(x * 2, y * 2));
      return RodapesReduzido(b, 0, 0);
    }
  }

  static string RodapesReduzido(Bitmap b, int x0, int y0) {
    const int F = 2;
    {
      int W = b.Width, H = b.Height;
      BitmapData bd = b.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      int stride = bd.Stride;
      byte[] buf = new byte[stride * H];
      Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
      b.UnlockBits(bd);

      var abertas = new List<int[]>(); // esquerda, direita, topo, fundo, limpas
      var feitas = new List<int[]>();
      for (int y = 0; y < H; y++) {
        var corridas = new List<int[]>();
        int ini = -1;
        for (int x = 0; x <= W; x++) {
          bool e = false;
          if (x < W) {
            int i = y * stride + x * 4;
            e = Math.Abs(buf[i + 2] - 24) <= 4 && Math.Abs(buf[i + 1] - 27) <= 4 && Math.Abs(buf[i] - 34) <= 4;
          }
          if (e && ini < 0) ini = x;
          if (!e && ini >= 0) { if (x - ini >= 300 / F) corridas.Add(new int[] { ini, x - 1 }); ini = -1; }
        }
        var usadas = new bool[corridas.Count];
        foreach (var a in abertas) {
          for (int k = 0; k < corridas.Count; k++) {
            if (usadas[k] || Math.Abs(corridas[k][0] - a[0]) > 2) continue;
            usadas[k] = true; a[3] = y + 1; a[4]++; a[1] = Math.Max(a[1], corridas[k][1]);
            break;
          }
        }
        for (int k = abertas.Count - 1; k >= 0; k--) {
          var a = abertas[k];
          if (y - a[3] > 30 / F) { if (a[3] - a[2] >= 40 / F && a[4] >= 12 / F) feitas.Add(a); abertas.RemoveAt(k); }
        }
        for (int k = 0; k < corridas.Count; k++)
          if (!usadas[k]) abertas.Add(new int[] { corridas[k][0], corridas[k][1], y, y + 1, 1 });
      }
      foreach (var a in abertas) if (a[3] - a[2] >= 40 / F && a[4] >= 12 / F) feitas.Add(a);

      var sb = new StringBuilder("[");
      for (int k = 0; k < feitas.Count; k++) {
        var a = feitas[k];
        if (k > 0) sb.Append(',');
        sb.AppendFormat("{{\"esquerda\":{0},\"direita\":{1},\"topo\":{2},\"fundo\":{3}}}", a[0] * F + x0, a[1] * F + F - 1 + x0, a[2] * F + y0, a[3] * F + y0);
      }
      return sb.Append(']').ToString();
    }
  }
}
"@
  Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing
  # Píxeis reais e não "virtuais": num ecrã com escala, sem isto as coordenadas mentem.
  [Olho]::SetProcessDPIAware() | Out-Null

  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
  # O idioma do jogo, se o Windows tiver o OCR dele instalado; senão os do perfil.
  # (O tipo Language tem de ser carregado assim antes de se usar, senão o
  # PowerShell 5 diz que não o encontra.)
  $motor = $null
  if ($Idioma) {
    [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
    $lingua = New-Object Windows.Globalization.Language($Idioma)
    if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lingua)) { $motor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lingua) }
  }
  if ($null -eq $motor) { $motor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if ($null -eq $motor) { [Console]::Out.WriteLine('ERR o Windows não tem nenhum idioma com OCR instalado'); exit 1 }
} catch {
  [Console]::Out.WriteLine('ERR arranque: ' + ($_.Exception.Message -replace '\s+', ' '))
  exit 1
}

function Esperar($op, $tipo) {
  $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}

# OCR de bytes PNG em memória → JSON das linhas, somando (dx, dy) às caixas.
# Nada de ficheiros abertos: o StorageFile segurava o PNG e o 2.º pedido falhava.
function LerPNG([byte[]]$bytes, [int]$dx, [int]$dy) {
  $mem = New-Object System.IO.MemoryStream(, $bytes)
  $s = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($mem)
  try {
    $d = Esperar ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $b = Esperar ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $r = Esperar ($motor.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult])
    $b.Dispose()
  } finally {
    $s.Dispose()
    $mem.Dispose()
  }
  # A caixa de cada linha é a união das palavras. Percorre-se com foreach:
  # no PowerShell 5, `$l.Words[0].BoundingRect.X` devolve um array e não um número.
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($l in $r.Lines) {
    $x1 = 1e9; $y1 = 1e9; $x2 = 0; $y2 = 0
    foreach ($w in $l.Words) {
      $rc = $w.BoundingRect
      if ($rc.X -lt $x1) { $x1 = $rc.X }
      if ($rc.Y -lt $y1) { $y1 = $rc.Y }
      if ($rc.X + $rc.Width -gt $x2) { $x2 = $rc.X + $rc.Width }
      if ($rc.Y + $rc.Height -gt $y2) { $y2 = $rc.Y + $rc.Height }
    }
    $out.Add([ordered]@{ x1 = [int]$x1 + $dx; y1 = [int]$y1 + $dy; x2 = [int]$x2 + $dx; y2 = [int]$y2 + $dy; t = $l.Text })
  }
  if ($out.Count -eq 0) { return '[]' }
  return (ConvertTo-Json -InputObject @($out.ToArray()) -Compress -Depth 3)
}

[Console]::Out.WriteLine('OK pronto ' + $motor.RecognizerLanguage.LanguageTag)

while ($true) {
  $linha = [Console]::In.ReadLine()
  if ($null -eq $linha) { break }
  $linha = $linha.Trim()
  if ($linha -eq '') { continue }
  if ($linha -eq 'SAIR') { break }
  try {
    if ($linha -eq 'PING') { [Console]::Out.WriteLine('OK pronto'); continue }

    if ($linha.StartsWith('OCR ')) {
      [Console]::Out.WriteLine('OK ' + (LerPNG ([System.IO.File]::ReadAllBytes($linha.Substring(4))) 0 0))
      continue
    }

    if ($linha.StartsWith('RODAPES ')) {
      [Console]::Out.WriteLine('OK ' + [Olho]::RodapesDeFicheiro($linha.Substring(8)))
      continue
    }

    if ($linha.StartsWith('VER')) {
      $p = $linha.Split(' ')
      $processo = if ($p.Count -gt 1) { $p[1] } else { 'AION2' }
      $j = [Olho]::JanelaDoJogo($processo)
      if ($null -eq $j -or $j[2] -lt 200 -or $j[3] -lt 200) { [Console]::Out.WriteLine('OK {"jogo":false}'); continue }
      $rod = [Olho]::Rodapes($j[0], $j[1], $j[2], $j[3])
      [Console]::Out.WriteLine('OK {"jogo":true,"janela":[' + ($j -join ',') + '],"rodapes":' + $rod + '}')
      continue
    }

    if ($linha.StartsWith('LER ')) {
      $p = $linha.Split(' ')
      $x = [int]$p[1]; $y = [int]$p[2]; $w = [int]$p[3]; $h = [int]$p[4]
      $bmp = [Olho]::Copiar($x, $y, $w, $h)
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      $bytes = $ms.ToArray()
      $ms.Dispose()
      [Console]::Out.WriteLine('OK ' + (LerPNG $bytes $x $y))
      continue
    }

    [Console]::Out.WriteLine('ERR ordem que não percebo')
  } catch {
    [Console]::Out.WriteLine('ERR ' + ($_.Exception.Message -replace '\s+', ' '))
  }
}
