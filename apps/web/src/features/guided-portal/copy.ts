export const guidedPortalCopy = {
  de: {
    title: "Begleitetes Ausfüllen",
    link: "Portal gemeinsam ausfüllen",
    introduction:
      "Öffnen Sie eine offizielle Seite. Der Lotse zeigt auf Felder und trägt Werte erst nach Ihrer Freigabe sichtbar ein.",
    url: "Adresse des Portals",
    open: "Portal in neuem Fenster öffnen",
    bookmark: "Lotse verbinden",
    instructions:
      "Ziehen Sie „Lotse verbinden“ in Ihre Lesezeichenleiste. Öffnen Sie das Portal und führen Sie dieses Lesezeichen dort aus. Nach jedem Seitenwechsel verbinden Sie es erneut. Falls die Seite Lesezeichen-Skripte blockiert, füllen Sie selbst aus oder verwenden Sie die Mac-App.",
    code: "Verbindungscode zum Kopieren",
    codeHelp:
      "Alternativ den vollständigen Code kopieren und im Portal in die Adressleiste einsetzen. Der Anfang muss javascript: lauten; manche Browser entfernen ihn beim Einfügen.",
    snapshot: "Sichtbare Felder erfassen",
    point: "Zeigen",
    value: "Gewünschter Wert",
    review: "Feldgruppe prüfen",
    warning:
      "Die Seite kann jede Eingabe sofort speichern. Prüfen Sie diese exakten Werte vor der Freigabe. Bereits getippte Zeichen bleiben auch nach einem Stopp erhalten. Absenden und Anmeldedaten übernimmt der Lotse nie.",
    approve: "Diese Werte freigeben und sichtbar eintragen",
    cancel: "Prüfung abbrechen",
    stop: "Tippen stoppen",
    disconnect: "Verbindung trennen",
    idle: "Noch kein Portal verbunden.",
    waiting: "Portal geöffnet. Aktivieren Sie dort das Lesezeichen.",
    ready: "Portal verbunden. Erfassen Sie die sichtbaren Felder.",
    captured: "Sichtbare Felder erfasst. Wählen Sie Werte zur Prüfung aus.",
    done: "Vorgang abgeschlossen. Prüfen Sie die Werte im Portal; den abschließenden Klick machen Sie selbst.",
    failed:
      "Vorgang gestoppt oder nicht möglich. Prüfen Sie die Seite und erfassen Sie die Felder erneut. Bereits eingegebene Zeichen können gespeichert sein.",
    blocked:
      "Verbindung nicht möglich: Prüfen Sie Popup-Sperre, Seitenschutz und die freigegebene Adresse. Sie können die Seite selbst ausfüllen.",
    closed: "Verbindung beendet. Nach einem Seitenwechsel erneut verbinden.",
    busy: "Werte werden sichtbar eingetragen …",
    noFields: "Keine unterstützten sichtbaren Textfelder gefunden.",
    source: "Quelle: Ihre Eingabe in dieser Feldgruppe.",
  },
  en: {
    title: "Guided filling",
    link: "Fill a portal together",
    introduction:
      "Open an official page. The guide points at fields and visibly types values only after your approval.",
    url: "Portal address",
    open: "Open portal in a new window",
    bookmark: "Connect guide",
    instructions:
      "Drag “Connect guide” to your bookmarks bar. Open the portal and run this bookmark there. Reconnect after each navigation. If the site blocks bookmark scripts, fill it yourself or use the Mac app.",
    code: "Connection code to copy",
    codeHelp:
      "Alternatively copy the entire code into the portal address bar. It must start with javascript:; some browsers remove that prefix when pasting.",
    snapshot: "Capture visible fields",
    point: "Point",
    value: "Desired value",
    review: "Review field group",
    warning:
      "The site may save every keystroke immediately. Review these exact values before approval. Stopping leaves characters already typed in place. The guide never submits or enters credentials.",
    approve: "Approve these values and type visibly",
    cancel: "Cancel review",
    stop: "Stop typing",
    disconnect: "Disconnect",
    idle: "No portal connected yet.",
    waiting: "Portal opened. Activate the bookmark there.",
    ready: "Portal connected. Capture the visible fields.",
    captured: "Visible fields captured. Choose values to review.",
    done: "Action completed. Check the portal values; you perform the final confirming click.",
    failed:
      "Action stopped or unavailable. Check the page and capture fields again. Characters already entered may have been saved.",
    blocked:
      "Connection unavailable: check popup blocking, page restrictions and the allowed address. You can fill the page yourself.",
    closed: "Disconnected. Reconnect after page navigation.",
    busy: "Typing approved values visibly …",
    noFields: "No supported visible text fields found.",
    source: "Source: your input in this field group.",
  },
} as const;
