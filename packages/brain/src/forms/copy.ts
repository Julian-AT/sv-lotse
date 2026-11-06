type CoverLetter = {
  title: string;
  subjectName: string;
  date: string;
  recipient: string | null;
  attachments: string[];
};
type AcquisitionCandidate = {
  publisher: string;
  title: string;
  versionDate: string | null;
  url: string;
};

export const formCopy = {
  de: {
    acquireSummary: (candidate: AcquisitionCandidate): string =>
      `Offizielles Formular herunterladen und als Vorlage registrieren?\nHerausgeber: ${candidate.publisher}\nTitel: ${candidate.title}\nStand: ${candidate.versionDate ?? "Nicht angegeben"}\nURL: ${candidate.url}`,
    coverLetter: (letter: CoverLetter): string =>
      `${letter.recipient ?? "Zuständige Stelle noch zu klären"}\n\n${letter.date}\nBetreff: ${letter.title}\nAntragstellende Person: ${letter.subjectName}\n\nSehr geehrte Damen und Herren,\n\nanbei der Antrag „${letter.title}“ für ${letter.subjectName}. Das Formular enthält ausschließlich bestätigte Angaben. Bitte prüfen Sie die Unterlagen.\n\nBeilagen (Checkliste, bitte vor Versand prüfen):\n${letter.attachments.length ? letter.attachments.map((item) => `☐ ${item}`).join("\n") : "Keine erforderlichen Beilagen im Katalog hinterlegt; bitte prüfen."}\n\nMit freundlichen Grüßen\n${letter.subjectName}`,
  },
  en: {
    acquireSummary: (candidate: AcquisitionCandidate): string =>
      `Download the official form and register it as a template?\nPublisher: ${candidate.publisher}\nTitle: ${candidate.title}\nDate: ${candidate.versionDate ?? "Not provided"}\nURL: ${candidate.url}`,
    coverLetter: (letter: CoverLetter): string =>
      `${letter.recipient ?? "Responsible office still to be resolved"}\n\n${letter.date}\nSubject: ${letter.title}\nApplicant: ${letter.subjectName}\n\nDear Sir or Madam,\n\nPlease find the application “${letter.title}” for ${letter.subjectName} enclosed. The form contains only confirmed information. Please review the documents.\n\nAttachments (checklist, please verify before sending):\n${letter.attachments.length ? letter.attachments.map((item) => `☐ ${item}`).join("\n") : "No required attachments recorded in the catalog; please verify."}\n\nKind regards\n${letter.subjectName}`,
  },
};
