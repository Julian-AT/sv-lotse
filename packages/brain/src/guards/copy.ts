export const guardCopy = {
  de: {
    handoff:
      "Medizinische Fragen und Entscheidungen besprechen Sie bitte mit Ihrer behandelnden Ärztin oder Ihrem behandelnden Arzt. Für telefonische Gesundheitsberatung erreichen Sie 1450. Ich helfe Ihnen mit dem Antrag, Ihren Verwaltungsunterlagen und dem Kontakt zur zuständigen Beratungsstelle.",
    unknown:
      "Diese Aussage kann ich mit den vorliegenden Quellen nicht belegen. Die Beratungsstelle der zuständigen Stelle kann sie klären. Ich helfe Ihnen, die Frage und die Unterlagen vorzubereiten.",
  },
  en: {
    handoff:
      "Please discuss medical questions and decisions with your treating doctor. For telephone health advice, call 1450. I can help with the application, documents and contacting the responsible counselling office.",
    unknown:
      "I cannot support this statement with the available sources. The responsible office's adviser can clarify it. I can help prepare the question and documents.",
  },
} as const;
export function guardLocale(language?: string): "de" | "en" {
  return language?.toLowerCase().startsWith("en") ? "en" : "de";
}
