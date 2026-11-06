export const pipelineCopy = {
  de: {
    clarifyGoal:
      "Gern helfe ich Ihnen bei Verwaltungsfragen zur Sozialversicherung. Was möchten Sie klären oder vorbereiten?",
    goal: (goal: string): string =>
      `Ich habe dieses Anliegen verstanden: ${goal} Ist das Ihr Ziel?`,
    openOffer: (label: string): string => `Soll ich ${label} für Sie öffnen?`,
    opening: (label: string): string => `Ich öffne ${label} und zeige Ihnen den Antrag.`,
    opened: "Die Seite ist jetzt geöffnet. Ich zeige Ihnen, wo es steht.",
    handoff:
      "Medizinische Fragen kann ich nicht beurteilen. Bitte besprechen Sie diese mit Ihrer Ärztin oder Ihrem Arzt; die Gesundheitsberatung erreichen Sie unter 1450. Bei organisatorischen Fragen helfe ich gern.",
    unsupported:
      "Dafür habe ich derzeit keine ausreichend belegte Auskunft. Bitte lassen Sie die Voraussetzungen von der zuständigen Stelle bestätigen. Ich helfe Ihnen, die offene Frage vorzubereiten.",
  },
  en: {
    clarifyGoal:
      "I can help with administrative social insurance questions. What would you like to clarify or prepare?",
    goal: (goal: string): string => `I understood your request as: ${goal} Is that your goal?`,
    openOffer: (label: string): string => `Shall I open ${label} for you?`,
    opening: (label: string): string => `I am opening ${label} and will show you the application.`,
    opened: "The page is open now. I will show you where it is.",
    handoff:
      "I cannot assess medical questions. Please discuss them with your doctor; health advice is available on 1450. I can help with administrative questions.",
    unsupported:
      "I do not currently have enough verified sources to answer that. Please confirm the requirements with the responsible office. I can help prepare the question.",
  },
} as const;
export function copyFor(language: string): typeof pipelineCopy.de | typeof pipelineCopy.en {
  return language.startsWith("en") ? pipelineCopy.en : pipelineCopy.de;
}
