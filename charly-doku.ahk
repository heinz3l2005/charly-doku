; charly-doku.ahk  (AutoHotkey v2)
; Hotkey: Strg+Alt+K
;  1. schneidet einen FEST definierten Bildschirmbereich ab (nur die Leistungszeilen!)
;  2. schickt das PNG an den Relay-Dienst (curl)
;  3. legt den zurueckgegebenen Karteitext in die Zwischenablage
;  4. zeigt eine Vorschau -> du pruefst und fuegst mit Strg+V in charly ein
;
; Voraussetzungen: AutoHotkey v2, curl (in Windows 10/11 enthalten), PowerShell.

#Requires AutoHotkey v2.0

; ---- KONFIGURATION -------------------------------------------------
; Bereich der LEISTUNGSZEILEN (Patientenname/Kopf bewusst AUSSPAREN -> Datenschutz).
; Einmal mit einem Screenshot-Tool die Pixel ablesen und hier eintragen:
CapX := 200      ; linke obere Ecke X
CapY := 300      ; linke obere Ecke Y
CapW := 900      ; Breite
CapH := 320      ; Hoehe

RelayUrl := "http://192.168.101.201:3000/doku"   ; Homeserver-IP + Port anpassen
TmpPng   := A_Temp "\charly_doku.png"
TmpOut   := A_Temp "\charly_doku.txt"
; --------------------------------------------------------------------

^!k:: {
    global CapX, CapY, CapW, CapH, RelayUrl, TmpPng, TmpOut

    ; 1) Screenshot des Bereichs via PowerShell (System.Drawing, keine Zusatzlib noetig)
    ps := "Add-Type -AssemblyName System.Drawing;"
        . "$b=New-Object System.Drawing.Bitmap(" CapW "," CapH ");"
        . "$g=[System.Drawing.Graphics]::FromImage($b);"
        . "$g.CopyFromScreen(" CapX "," CapY ",0,0,$b.Size);"
        . "$b.Save('" TmpPng "');"
    RunWait('powershell -NoProfile -WindowStyle Hidden -Command "' ps '"', , "Hide")

    if !FileExist(TmpPng) {
        MsgBox("Screenshot fehlgeschlagen.", "charly-doku", 48)
        return
    }

    ; 2) An Relay senden (Antwort ist reiner Text)
    if FileExist(TmpOut)
        FileDelete(TmpOut)
    cmd := 'curl -s -X POST "' RelayUrl '" -F "image=@' TmpPng ';type=image/png"'
    RunWait(A_ComSpec ' /c ' cmd ' > "' TmpOut '"', , "Hide")

    if !FileExist(TmpOut) {
        MsgBox("Keine Antwort vom Relay.", "charly-doku", 48)
        return
    }
    txt := FileRead(TmpOut, "UTF-8")
    FileDelete(TmpPng)   ; Bild lokal wieder loeschen (Datensparsamkeit)

    if (Trim(txt) = "") {
        MsgBox("Leere Antwort erhalten.", "charly-doku", 48)
        return
    }

    ; 3) Markdown -> HTML konvertieren (Fett/Kursiv) und als HTML in Zwischenablage,
    ;    damit charly (Rich-Text-Feld) die Formatierung uebernimmt.
    html := MarkdownToHtml(txt)
    SetHtmlClipboard(html, txt)
    MsgBox("Karteitext liegt formatiert in der Zwischenablage.`n`nBitte pruefen, dann mit Strg+V in charly einfuegen.`n`n--- Vorschau (Klartext) ---`n`n" SubStr(txt, 1, 1500), "charly-doku - Freigabe", 64)

    ; Auto-Einfuegen (optional): naechste Zeile einkommentieren, ersetzt die manuelle Freigabe.
    ; SendText(txt)
}

; --------------------------------------------------------------------
; Hotkey Strg+Alt+B: nimmt Markdown-Text mit **fett** aus der Zwischenablage,
; konvertiert zu RTF und schreibt RTF + Klartext (ohne Marker) in die Zwischenablage.
; So kann charly's Rich-Edit-Feld (das nur RTF, nicht HTML versteht) die Fett-Formatierung
; beim Einfuegen uebernehmen.
;
; Workflow:
;   1. In der Web-App /baustein oder / "Fuer charly kopieren (** Marker)" klicken.
;   2. Strg+Umschalt+B druecken (^+b - Strg+Alt+B wird von TeamViewer abgefangen).
;   3. In charly Strg+V.
^+b:: {
    plain := A_Clipboard
    if (Trim(plain) = "") {
        MsgBox("Zwischenablage ist leer.", "charly-doku RTF-Konvertierung", 48)
        return
    }
    rtf := MarkdownToRtf(plain)
    plainClean := RegExReplace(plain, "\*\*(.+?)\*\*", "$1")
    SetRtfClipboard(rtf, plainClean)
    ToolTip("charly-doku: als RTF konvertiert. Jetzt Strg+V in charly.")
    SetTimer () => ToolTip(), -2500
}

; --------------------------------------------------------------------
; Markdown -> RTF (nur **fett** und Zeilenumbrueche)
MarkdownToRtf(md) {
    text := md
    ; Reihenfolge wichtig: erst RTF-Sonderzeichen escapen, dann **fett** umsetzen.
    text := StrReplace(text, "\", "\\")
    text := StrReplace(text, "{", "\{")
    text := StrReplace(text, "}", "\}")
    ; **fett** -> {\b fett}
    text := RegExReplace(text, "\*\*(.+?)\*\*", "{\b $1}")
    ; Zeilenumbrueche -> \par
    text := StrReplace(text, "`r`n", "`n")
    text := StrReplace(text, "`n", "\par`r`n")
    return "{\rtf1\ansi\ansicpg1252\deff0\deflang1031{\fonttbl{\f0\fnil Segoe UI;}}\fs20 " . text . "}"
}

; RTF in Windows-Zwischenablage (CF_RTF) via PowerShell schreiben, plainText als CF_UNICODETEXT.
SetRtfClipboard(rtf, plainText) {
    tmpRtf := A_Temp "\charly_doku_rtf.rtf"
    tmpTxt := A_Temp "\charly_doku_rtf.txt"
    if FileExist(tmpRtf)
        FileDelete(tmpRtf)
    if FileExist(tmpTxt)
        FileDelete(tmpTxt)
    FileAppend(rtf, tmpRtf, "UTF-8")
    FileAppend(plainText, tmpTxt, "UTF-8")
    ps := "$r = Get-Content -Raw -Encoding UTF8 '" tmpRtf "';"
        . "$t = Get-Content -Raw -Encoding UTF8 '" tmpTxt "';"
        . "Add-Type -AssemblyName System.Windows.Forms;"
        . "$do = New-Object System.Windows.Forms.DataObject;"
        . "$do.SetData('Rich Text Format', $r);"
        . "$do.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $t);"
        . "[System.Windows.Forms.Clipboard]::SetDataObject($do, $true);"
    RunWait('powershell -NoProfile -STA -WindowStyle Hidden -Command "' ps '"', , "Hide")
    FileDelete(tmpRtf)
    FileDelete(tmpTxt)
}

; --------------------------------------------------------------------
; Markdown -> HTML (nur Fett **x**, Kursiv *x*, Zeilenumbrueche)
MarkdownToHtml(md) {
    s := md
    ; HTML-escape
    s := StrReplace(s, "&", "&amp;")
    s := StrReplace(s, "<", "&lt;")
    s := StrReplace(s, ">", "&gt;")
    ; **fett**
    s := RegExReplace(s, "\*\*(.+?)\*\*", "<b>$1</b>")
    ; *kursiv* (nur wenn nicht gerade Bulletpoint am Zeilenanfang)
    s := RegExReplace(s, "(?<![\*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)", "<i>$1</i>")
    ; Zeilenumbrueche -> <br>
    s := StrReplace(s, "`r`n", "`n")
    s := StrReplace(s, "`n", "<br>`r`n")
    return "<html><body>" s "</body></html>"
}

; HTML in die Windows-Zwischenablage schreiben (fuer Apps, die HTML-Paste unterstuetzen,
; z. B. Word/WordPad/Outlook). plainFallback als Klartext-Fallback.
SetHtmlClipboard(html, plainFallback) {
    tmpHtml := A_Temp "\charly_doku_clip.html"
    tmpTxt  := A_Temp "\charly_doku_clip.txt"
    if FileExist(tmpHtml)
        FileDelete(tmpHtml)
    if FileExist(tmpTxt)
        FileDelete(tmpTxt)
    FileAppend(html, tmpHtml, "UTF-8")
    FileAppend(plainFallback, tmpTxt, "UTF-8")
    ps := "$h = Get-Content -Raw -Encoding UTF8 '" tmpHtml "';"
        . "$t = Get-Content -Raw -Encoding UTF8 '" tmpTxt "';"
        . "Add-Type -AssemblyName System.Windows.Forms;"
        . "$do = New-Object System.Windows.Forms.DataObject;"
        . "$do.SetData([System.Windows.Forms.DataFormats]::Html, $h);"
        . "$do.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $t);"
        . "[System.Windows.Forms.Clipboard]::SetDataObject($do, $true);"
    RunWait('powershell -NoProfile -STA -WindowStyle Hidden -Command "' ps '"', , "Hide")
    FileDelete(tmpHtml)
    FileDelete(tmpTxt)
}
