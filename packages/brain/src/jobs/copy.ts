export const jobCopy = {
  de: {
    pending: "Die Aufgabe wartet auf die Bearbeitung.",
    running: "Die Aufgabe wird im Hintergrund bearbeitet.",
    completed: "Die Hintergrundaufgabe ist abgeschlossen. Die Ergebnisse sind bereit.",
    failed: "Die Hintergrundaufgabe konnte nicht abgeschlossen werden.",
    cancelled: "Die Hintergrundaufgabe wurde beendet.",
  },
  en: {
    pending: "The task is waiting to be processed.",
    running: "The task is being processed in the background.",
    completed: "The background task is complete. The results are ready.",
    failed: "The background task could not be completed.",
    cancelled: "The background task was cancelled.",
  },
} as const;
