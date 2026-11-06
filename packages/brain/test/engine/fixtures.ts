import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { type ProcessDefinition, processDefinitionSchema } from "../../src/engine/schema.ts";

const directory = new URL("../../../knowledge/processes/", import.meta.url);
export const corpus = readdirSync(directory)
  .filter((name) => name.endsWith(".yaml"))
  .map((name) =>
    processDefinitionSchema.parse(parse(readFileSync(new URL(name, directory), "utf8"))),
  );

// Constructed graph uses the real catalog's provenance and covers isolated graph mechanics.
export function definition(): ProcessDefinition {
  const source = corpus[0];
  if (!source) throw new Error("Missing process corpus");
  return {
    ...source,
    id: "test-flow",
    benefit: "ref:catalog/test-benefit",
    actor_roles: ["subject"],
    slots: [
      { id: "accepted", type: "boolean", question_hint: "Bestätigen Sie die Angabe?" },
      {
        id: "region",
        type: "enum:region",
        from_context: "residence.region",
        question_hint: "In welchem Bundesland wohnen Sie?",
        validation: { options: ["Wien", "Tirol"] },
      },
      {
        id: "name",
        type: "string",
        question_hint: "Wie heißen Sie?",
        validation: { min_length: 2 },
      },
    ],
    steps: [
      {
        id: "intake",
        needs: ["accepted", "region"],
        transitions: [
          { to: "prepare", when: "accepted == true" },
          { to: "contact", when: "accepted == false" },
        ],
      },
      { id: "prepare", needs: ["intake", "name"], transitions: [{ to: "finish" }] },
      { id: "contact", needs: ["intake"], transitions: [{ to: "finish" }] },
      { id: "finish", needs: [] },
    ],
    completion: { evidence: ["user_statement", "document_present", "artefact_built"] },
  };
}
export const evidence = { type: "user_statement", text: "Ich habe diesen Schritt erledigt." };
