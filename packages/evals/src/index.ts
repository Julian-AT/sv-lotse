export { assertNoLeakage, checkLeakage, type Leakage } from "./checks/leakage.ts";
export { EvaluationProviderError, TransportError } from "./errors.ts";
export { exportResults } from "./export.ts";
export {
  JUDGE_PROMPT_VERSION,
  type JudgeRun,
  JudgeRunSchema,
  judge,
  loadRubric,
  type Rubric,
  RubricSchema,
  scoreSchema,
} from "./judge/index.ts";
export {
  PERSONA_PROMPT_VERSION,
  PersonaActionSchema,
  PersonaResultSchema,
  type PersonaSpec,
  PersonaSpecSchema,
  SystemReplySchema,
  type SystemUnderTest,
  simulatePersona,
} from "./persona/index.ts";
export {
  type RegisteredSuite,
  Registry,
  type RunOptions,
  runSuite,
  type Selection,
  selectCases,
} from "./runner/index.ts";
export {
  type CaseResult,
  CaseResultSchema,
  CaseSchema,
  type EvalCase,
  type Evaluation,
  EvaluationSchema,
  IntervalSchema,
  type JudgeResult,
  JudgeResultSchema,
  JudgeVersionSchema,
  SourceSchema,
  SubsetSchema,
  type Suite,
  SuiteIdSchema,
  type SuiteResult,
  SuiteResultSchema,
  SuiteSchema,
  SummarySchema,
} from "./schema/index.ts";
export {
  cohensKappa,
  mean,
  ndcgAtK,
  proportion,
  recallAtK,
  wilsonInterval,
} from "./stats/index.ts";
